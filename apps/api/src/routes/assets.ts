import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { HttpError } from "../errors.js";
import type { RouteDependencies } from "./dependencies.js";
import { getFastifySchema, identity, params } from "./route-utils.js";

interface AssetRow {
  id: string;
  original_name: string;
  stored_name: string;
  mime_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  byte_size: number;
  created_at: string;
}

/** 通过文件魔数识别图片，不能只信任客户端声明的 MIME。 */
function detectImageMime(buffer: Buffer): AssetRow["mime_type"] | null {
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))
  ) {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** 返回白名单 MIME 对应的不可执行文件扩展名。 */
function extensionFor(mime: AssetRow["mime_type"]): string {
  return {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
  }[mime];
}

/** 清理下载文件名中的控制字符并限制数据库字段长度。 */
function sanitizeOriginalName(fileName: string, fallback: string): string {
  return (
    Array.from(basename(fileName), (character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? "_" : character;
    })
      .join("")
      .slice(0, 255) || fallback
  );
}

/** 图片上传和不可变二进制读取路由。 */
export const assetRoutes: FastifyPluginAsync<RouteDependencies> = async (
  app,
  dependencies,
) => {
  app.post(
    "/api/assets",
    { schema: getFastifySchema("uploadAsset") },
    async (request, reply) => {
      const user = identity(dependencies, request);
      const file = await request.file();
      if (!file) {
        throw new HttpError(
          422,
          "ASSET_FILE_REQUIRED",
          "multipart 请求必须提供 file 字段",
        );
      }
      const buffer = await file.toBuffer();
      const detected = detectImageMime(buffer);
      if (!detected || detected !== file.mimetype) {
        throw new HttpError(
          415,
          "UNSUPPORTED_IMAGE",
          "仅支持签名与 MIME 一致的 PNG/JPEG/GIF/WebP 图片",
        );
      }

      const id = randomUUID();
      const storedName = `${id}.${extensionFor(detected)}`;
      const originalName = sanitizeOriginalName(file.filename, storedName);
      const createdAt = new Date().toISOString();
      const target = join(dependencies.uploadsDirectory, storedName);
      await writeFile(target, buffer, { flag: "wx" });
      try {
        dependencies.db
          .prepare(
            "INSERT INTO assets(id, original_name, stored_name, mime_type, byte_size, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            id,
            originalName,
            storedName,
            detected,
            buffer.length,
            user.id,
            createdAt,
          );
      } catch (error) {
        // 数据库写入失败时删除孤立文件，保持文件系统与元数据一致。
        await unlink(target).catch(() => undefined);
        throw error;
      }
      return reply.status(201).send({
        id,
        assetId: id,
        fileName: originalName,
        name: originalName,
        mimeType: detected,
        byteSize: buffer.length,
        size: buffer.length,
        url: `/api/assets/${id}`,
        createdAt,
      });
    },
  );

  app.get(
    "/api/assets/:assetId",
    { schema: getFastifySchema("readAsset") },
    async (request, reply) => {
      const row = dependencies.db
        .prepare(
          "SELECT id, original_name, stored_name, mime_type, byte_size, created_at FROM assets WHERE id = ?",
        )
        .get(params(request).assetId!) as unknown as AssetRow | undefined;
      if (!row) throw new HttpError(404, "ASSET_NOT_FOUND", "图片资产不存在");

      reply
        .type(row.mime_type)
        .header("content-length", row.byte_size)
        .header("cache-control", "public, max-age=31536000, immutable")
        .header(
          "content-disposition",
          `inline; filename="${encodeURIComponent(row.original_name)}"`,
        );
      return reply.send(
        createReadStream(join(dependencies.uploadsDirectory, row.stored_name)),
      );
    },
  );
};
