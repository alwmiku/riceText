import { AssetSchema, type ForumUser } from "@ricetext/contracts";
import {
  detectImageMime,
  extensionForImage,
  sanitizeOriginalName,
  sha256Hex,
} from "@ricetext/server-core";
import { WorkerHttpError } from "../http-error";

const MAX_ASSET_BYTES = 8 * 1024 * 1024;
type ObjectBucket = Pick<R2Bucket, "put" | "get" | "delete">;

type AssetRow = {
  id: string;
  original_name: string;
  object_key: string | null;
  mime_type: string;
  byte_size: number;
  checksum: string | null;
  state: "pending" | "ready" | "failed";
  created_at: string;
};

type ProtectedAttachment = {
  id: string;
  name: string;
  author_id: string;
};

/** 清理长期停留在 pending/failed 的元数据和 R2 对象，避免数据库与对象存储持续漂移。 */
export async function cleanupStaleAssets(
  db: D1Database,
  bucket: Pick<R2Bucket, "delete">,
  cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString(),
): Promise<number> {
  const result = await db
    .prepare(
      "SELECT id, object_key FROM assets " +
        "WHERE state IN ('pending', 'failed') AND updated_at < ? LIMIT 100",
    )
    .bind(cutoff)
    .all<{ id: string; object_key: string | null }>();
  let removed = 0;
  for (const row of result.results) {
    if (row.object_key) await bucket.delete(row.object_key).catch(() => undefined);
    const deleted = await db
      .prepare("DELETE FROM assets WHERE id = ? AND state IN ('pending', 'failed')")
      .bind(row.id)
      .run();
    removed += deleted.meta.changes;
  }
  return removed;
}

/** 资产写入采用“先建 pending 元数据、再写 R2、最后标 ready”的补偿式流程。 */
export class D1AssetRepository {
  constructor(
    private readonly db: D1Database,
    private readonly bucket: ObjectBucket,
  ) {}

  async upload(file: File, principal: ForumUser): Promise<ReturnType<typeof AssetSchema.parse>> {
    if (file.size > MAX_ASSET_BYTES) {
      throw new WorkerHttpError(413, "ASSET_TOO_LARGE", "图片不能超过 8 MiB");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = detectImageMime(bytes);
    if (!detected || detected !== file.type) {
      throw new WorkerHttpError(
        415,
        "UNSUPPORTED_IMAGE",
        "仅支持签名与 MIME 一致的 PNG/JPEG/GIF/WebP 图片",
      );
    }
    const id = crypto.randomUUID();
    const extension = extensionForImage(detected);
    const objectKey = "images/" + id + "." + extension;
    const originalName = sanitizeOriginalName(file.name, id + "." + extension);
    const checksum = await sha256Hex(bytes);
    const createdAt = new Date().toISOString();
    await this.db
      .prepare(
        "INSERT INTO assets(" +
          "id, original_name, object_key, mime_type, byte_size, checksum, state, " +
          "created_by, created_at, updated_at" +
          ") VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
      )
      .bind(
        id,
        originalName,
        objectKey,
        detected,
        bytes.byteLength,
        checksum,
        principal.id,
        createdAt,
        createdAt,
      )
      .run();

    let stored = false;
    try {
      await this.bucket.put(objectKey, bytes, {
        httpMetadata: { contentType: detected },
        customMetadata: { assetId: id, checksum },
        onlyIf: { etagDoesNotMatch: "*" },
      });
      stored = true;
      const ready = await this.db
        .prepare("UPDATE assets SET state = 'ready', updated_at = ? WHERE id = ? AND state = 'pending'")
        .bind(new Date().toISOString(), id)
        .run();
      if (ready.meta.changes !== 1) throw new Error("Asset state transition failed");
    } catch (error) {
      if (stored) await this.bucket.delete(objectKey).catch(() => undefined);
      await this.db
        .prepare("UPDATE assets SET state = 'failed', updated_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), id)
        .run()
        .catch(() => undefined);
      throw error;
    }

    return AssetSchema.parse({
      id,
      assetId: id,
      fileName: originalName,
      name: originalName,
      mimeType: detected,
      byteSize: bytes.byteLength,
      size: bytes.byteLength,
      url: "/api/assets/" + id,
      createdAt,
    });
  }

  private async protectedAttachment(assetId: string): Promise<ProtectedAttachment | null> {
    return this.db
      .prepare("SELECT id, name, author_id FROM attachments WHERE asset_id = ? LIMIT 1")
      .bind(assetId)
      .first<ProtectedAttachment>();
  }

  private async requireAssetAccess(
    assetId: string,
    attachment: ProtectedAttachment,
    principal: ForumUser | null,
  ): Promise<ForumUser> {
    if (!principal) throw new WorkerHttpError(401, "AUTH_REQUIRED", "请先登录");
    if (principal.id === attachment.author_id || principal.role === "moderator") {
      return principal;
    }
    const purchase = await this.db
      .prepare(
        "SELECT 1 AS purchased FROM attachment_purchases WHERE attachment_id = ? AND buyer_id = ?",
      )
      .bind(attachment.id, principal.id)
      .first<{ purchased: number }>();
    if (!purchase) {
      throw new WorkerHttpError(403, "ATTACHMENT_NOT_PURCHASED", "购买附件后才能下载");
    }
    return principal;
  }

  async read(assetId: string, request: Request, principal: ForumUser | null): Promise<Response> {
    const row = await this.db
      .prepare(
        "SELECT id, original_name, object_key, mime_type, byte_size, checksum, state, created_at " +
          "FROM assets WHERE id = ? AND state = 'ready'",
      )
      .bind(assetId)
      .first<AssetRow>();
    if (!row?.object_key) throw new WorkerHttpError(404, "ASSET_NOT_FOUND", "图片资产不存在");
    const attachment = await this.protectedAttachment(assetId);
    if (attachment) await this.requireAssetAccess(assetId, attachment, principal);

    const rangeHeader = request.headers.get("range");
    let range: R2Range | undefined;
    let rangeStart = 0;
    let rangeEnd = row.byte_size - 1;
    if (rangeHeader) {
      const match = /^bytes=([0-9]*)-([0-9]*)$/.exec(rangeHeader);
      if (!match || (!match[1] && !match[2])) {
        return new Response(null, {
          status: 416,
          headers: { "content-range": "bytes */" + String(row.byte_size) },
        });
      }
      if (!match[1]) {
        const suffix = Math.min(Number(match[2]), row.byte_size);
        rangeStart = row.byte_size - suffix;
        range = { suffix };
      } else {
        rangeStart = Number(match[1]);
        rangeEnd = match[2] ? Math.min(Number(match[2]), row.byte_size - 1) : row.byte_size - 1;
        if (rangeStart >= row.byte_size || rangeEnd < rangeStart) {
          return new Response(null, {
            status: 416,
            headers: { "content-range": "bytes */" + String(row.byte_size) },
          });
        }
        range = { offset: rangeStart, length: rangeEnd - rangeStart + 1 };
      }
    }

    const object = await this.bucket.get(row.object_key, range ? { range } : undefined);
    if (!object) {
      throw new WorkerHttpError(404, "ASSET_OBJECT_NOT_FOUND", "资产对象不存在");
    }
    const etag = object.httpEtag;
    if (!range && request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { etag } });
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-type", row.mime_type);
    headers.set("etag", etag);
    headers.set("accept-ranges", "bytes");
    headers.set(
      "cache-control",
      attachment ? "private, no-store" : "public, max-age=31536000, immutable",
    );
    const downloadName = attachment?.name ?? row.original_name;
    headers.set(
      "content-disposition",
      (attachment ? "attachment" : "inline") +
        "; filename*=UTF-8''" +
        encodeURIComponent(downloadName),
    );
    if (range) {
      if ("suffix" in range) rangeEnd = row.byte_size - 1;
      headers.set(
        "content-range",
        "bytes " + String(rangeStart) + "-" + String(rangeEnd) + "/" + String(row.byte_size),
      );
      headers.set("content-length", String(rangeEnd - rangeStart + 1));
    } else {
      headers.set("content-length", String(row.byte_size));
    }
    return new Response(object.body, { status: range ? 206 : 200, headers });
  }
}
