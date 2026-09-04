import type { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import type { TiptapDocument } from "@ricetext/contracts";
import {
  convertLongTextBlocksToChapters,
  type JSONContent,
} from "@ricetext/document-core";
import { chapterStorageId } from "@ricetext/server-core";
import { HttpError } from "../errors.js";

export class ChapterService {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** 章节目录。 */
  chapters(documentId: string): Array<{
    id: string;
    title: string;
    volumeTitle: string;
    order: number;
    documentId: string;
    revision: number;
    hasContent: boolean;
    savedAt: string;
    hidden: boolean;
  }> {
    const rows = this.#db
      .prepare(
        "SELECT id, title, volume_title, sort_order, document_id, revision, content_json, updated_at, hidden " +
          "FROM chapters WHERE document_id = ? ORDER BY sort_order",
      )
      .all(documentId) as Array<{
      id: string;
      title: string;
      volume_title: string;
      sort_order: number;
      document_id: string;
      revision: number;
      content_json: string | null;
      updated_at: string;
      hidden: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      volumeTitle: row.volume_title,
      order: row.sort_order,
      documentId: row.document_id,
      revision: row.revision,
      hasContent: row.content_json !== null,
      savedAt: row.updated_at,
      hidden: row.hidden === 1,
    }));
  }

  /** 读取分章上传的正文；目录占位行在首次保存前没有正文。 */
  chapterContent(documentId: string, chapterId: string) {
    const row = this.#db
      .prepare(
        "SELECT id, title, volume_title, sort_order, document_id, revision, updated_at, hidden, content_json " +
          "FROM chapters WHERE id = ? AND document_id = ?",
      )
      .get(chapterId, documentId) as
      | {
          id: string;
          title: string;
          volume_title: string;
          sort_order: number;
          document_id: string;
          revision: number;
          updated_at: string;
          hidden: number;
          content_json: string | null;
        }
      | undefined;
    if (!row?.content_json)
      throw new HttpError(404, "CHAPTER_NOT_FOUND", "章节正文不存在");
    return {
      id: row.id,
      title: row.title,
      volumeTitle: row.volume_title,
      order: row.sort_order,
      documentId: row.document_id,
      revision: row.revision,
      savedAt: row.updated_at,
      hidden: row.hidden === 1,
      content: convertLongTextBlocksToChapters(
        JSON.parse(row.content_json),
      ) as TiptapDocument,
    };
  }

  /** 服务器已有章节的内容哈希（id -> hash），用于差异对比。 */
  chapterHashes(documentId: string): Map<string, string | null> {
    const rows = this.#db
      .prepare("SELECT id, content_hash FROM chapters WHERE document_id = ?")
      .all(documentId) as Array<{ id: string; content_hash: string | null }>;
    return new Map(rows.map((row) => [row.id, row.content_hash]));
  }

  /**
   * 注册正文中已出现但目录缺失的新章节（编辑器「新增章节」只改正文）。
   *
   * id 由服务端按位置分配（chapter-<order>）；同位置重复注册幂等返回同一行，
   * 行标题与排序跟随本次输入。返回行供客户端把服务器 id 同步回本地目录。
   * 新行以 revision = 0 落库（尚未真正保存），保存文档时再递增为 1。
   */
  createChapter(
    documentId: string,
    input: { title: string; order: number },
  ): {
    id: string;
    title: string;
    order: number;
    documentId: string;
    revision: number;
    savedAt: string;
    hidden: boolean;
    created: boolean;
  } {
    const id = chapterStorageId(documentId, input.order);
    const now = new Date().toISOString();
    const result = this.#db
      .prepare(
        `INSERT OR IGNORE INTO chapters(id, title, sort_order, document_id, revision, updated_at)
         VALUES (?, ?, ?, ?, 0, ?)`,
      )
      .run(id, input.title, input.order, documentId, now);
    this.#db
      .prepare(
        "UPDATE chapters SET title = ?, sort_order = ? WHERE id = ? AND document_id = ?",
      )
      .run(input.title, input.order, id, documentId);
    const row = this.#db
      .prepare(
        "SELECT id, title, sort_order, document_id, revision, updated_at, hidden FROM chapters WHERE id = ? AND document_id = ?",
      )
      .get(id, documentId) as {
      id: string;
      title: string;
      sort_order: number;
      document_id: string;
      revision: number;
      updated_at: string;
      hidden: number;
    };
    return {
      id: row.id,
      title: row.title,
      order: row.sort_order,
      documentId: row.document_id,
      revision: row.revision,
      savedAt: row.updated_at,
      hidden: row.hidden === 1,
      created: result.changes === 1,
    };
  }

  /**
   * 删除章节目录行（幂等：不存在时返回 deleted = false）。
   *
   * 历史修订、独立章节版本号均不受影响；关联校订建议解除章节归属（不删除，
   * 保留审核轨迹）——否则 suggestions.chapter_id 的外键会阻止删除。
   */
  deleteChapter(
    documentId: string,
    chapterId: string,
  ): { id: string; deleted: boolean } {
    const existing = this.#db
      .prepare(
        "SELECT sort_order FROM chapters WHERE id = ? AND document_id = ?",
      )
      .get(chapterId, documentId) as { sort_order: number } | undefined;
    if (!existing) return { id: chapterId, deleted: false };
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const now = new Date().toISOString();
      this.#db
        .prepare(
          "UPDATE suggestions SET chapter_id = NULL " +
            "WHERE document_id = ? AND chapter_id = ?",
        )
        .run(documentId, chapterId);
      this.#db
        .prepare("DELETE FROM chapters WHERE id = ? AND document_id = ?")
        .run(chapterId, documentId);
      // 两阶段换序避开 UNIQUE(document_id, sort_order) 的瞬时占用冲突。
      this.#db
        .prepare(
          "UPDATE chapters SET sort_order = -sort_order - 1 " +
            "WHERE document_id = ? AND sort_order > ?",
        )
        .run(documentId, existing.sort_order);
      this.#db
        .prepare(
          "UPDATE chapters SET sort_order = -sort_order - 2, " +
            "revision = revision + 1, updated_at = ? " +
            "WHERE document_id = ? AND sort_order < ?",
        )
        .run(now, documentId, -existing.sort_order - 1);
      this.#db.exec("COMMIT");
      return { id: chapterId, deleted: true };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * 隐藏/恢复章节目录行：隐藏的章节读者不可读，作者写完取消隐藏后恢复可读。
   */
  updateChapterHidden(
    documentId: string,
    chapterId: string,
    hidden: boolean,
  ): {
    id: string;
    title: string;
    order: number;
    documentId: string;
    revision: number;
    savedAt: string;
    hidden: boolean;
  } {
    const result = this.#db
      .prepare("UPDATE chapters SET hidden = ? WHERE id = ? AND document_id = ?")
      .run(hidden ? 1 : 0, chapterId, documentId);
    if (result.changes === 0)
      throw new HttpError(404, "CHAPTER_NOT_FOUND", "章节目录中不存在该章节");
    const row = this.#db
      .prepare(
        "SELECT id, title, sort_order, document_id, revision, updated_at, hidden FROM chapters WHERE id = ? AND document_id = ?",
      )
      .get(chapterId, documentId) as {
      id: string;
      title: string;
      sort_order: number;
      document_id: string;
      revision: number;
      updated_at: string;
      hidden: number;
    };
    return {
      id: row.id,
      title: row.title,
      order: row.sort_order,
      documentId: row.document_id,
      revision: row.revision,
      savedAt: row.updated_at,
      hidden: row.hidden === 1,
    };
  }

  /**
   * 保存章节内容（幂等写入由调用方负责）。返回更新后的章节与版本号。
   * content_hash 用于后续差异对比；相同哈希视为内容未变化。
   */
  saveChapter(
    documentId: string,
    chapterId: string,
    input: {
      title: string;
      order: number;
      content: TiptapDocument;
      hash: string;
      baseRevision: number;
    },
  ): { id: string; title: string; order: number; revision: number } {
    const existing = this.#db
      .prepare("SELECT revision FROM chapters WHERE document_id = ? AND id = ?")
      .get(documentId, chapterId) as { revision: number } | undefined;
    if (existing && existing.revision !== input.baseRevision)
      throw new HttpError(
        409,
        "CHAPTER_REVISION_CONFLICT",
        "章节已被其他修改更新，请重新对比差异",
        {
          currentRevision: existing.revision,
          baseRevision: input.baseRevision,
        },
      );
    const content = convertLongTextBlocksToChapters(
      input.content as unknown as JSONContent,
    ) as TiptapDocument;
    const revision = (existing?.revision ?? 0) + 1;
    this.#db
      .prepare(
        `INSERT INTO chapters(id, title, sort_order, document_id, revision, content_json, content_hash, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(document_id, id) DO UPDATE SET
           title = excluded.title,
           sort_order = excluded.sort_order,
           revision = excluded.revision,
           content_json = excluded.content_json,
           content_hash = excluded.content_hash,
           updated_at = excluded.updated_at
         `,
      )
      .run(
        chapterId,
        input.title,
        input.order,
        documentId,
        revision,
        JSON.stringify(content),
        input.hash,
        new Date().toISOString(),
      );
    return { id: chapterId, title: input.title, order: input.order, revision };
  }

  createUpload(
    documentId: string,
    manifestHash: string,
    totalChapters: number,
  ) {
    const document = this.#db
      .prepare("SELECT 1 AS found FROM documents WHERE id = ?")
      .get(documentId);
    if (!document) throw new HttpError(404, "DOCUMENT_NOT_FOUND", "文档不存在");
    let existing = this.#db
      .prepare(
        "SELECT id, status FROM chapter_uploads " +
          "WHERE document_id = ? AND manifest_hash = ? AND status = 'uploading' " +
          "ORDER BY created_at DESC LIMIT 1",
      )
      .get(documentId, manifestHash) as
      | { id: string; status: "uploading" }
      | undefined;
    if (!existing) {
      const recoverable = this.#db
        .prepare(
          "SELECT id FROM chapter_uploads WHERE document_id=? AND manifest_hash=? AND status='aborted' ORDER BY created_at DESC LIMIT 1",
        )
        .get(documentId, manifestHash) as { id: string } | undefined;
      if (recoverable) {
        const reopened = this.#db
          .prepare("UPDATE chapter_uploads SET status='uploading' WHERE document_id=? AND id=? AND status='aborted'")
          .run(documentId, recoverable.id);
        if (reopened.changes === 1) existing = { ...recoverable, status: "uploading" };
      }
    }
    const uploadId = existing?.id ?? `upload_${randomUUID()}`;
    if (!existing) {
      this.#db
        .prepare(
          "INSERT INTO chapter_uploads(document_id, id, manifest_hash, total_chapters, status, created_at) " +
            "VALUES (?, ?, ?, ?, 'uploading', ?)",
        )
        .run(documentId, uploadId, manifestHash, totalChapters, new Date().toISOString());
    }
    const staged = this.#db
      .prepare(
        "SELECT chapter_id FROM chapter_upload_items " +
          "WHERE document_id = ? AND upload_id = ? ORDER BY sort_order",
      )
      .all(documentId, uploadId) as Array<{ chapter_id: string }>;
    return {
      uploadId,
      manifestHash,
      totalChapters,
      status: "uploading" as const,
      staged: staged.map((row) => row.chapter_id),
    };
  }

  stageUploadBatch(
    documentId: string,
    uploadId: string,
    items: Array<{
      id: string;
      title: string;
      volumeTitle: string;
      order: number;
      content: TiptapDocument;
      hash: string;
      baseRevision: number;
    }>,
  ) {
    const upload = this.#db
      .prepare(
        "SELECT total_chapters FROM chapter_uploads " +
          "WHERE document_id = ? AND id = ? AND status = 'uploading'",
      )
      .get(documentId, uploadId) as { total_chapters: number } | undefined;
    if (!upload) throw new HttpError(409, "CHAPTER_UPLOAD_NOT_ACTIVE", "上传会话不存在或已结束");
    const seenIds = new Set<string>();
    const seenOrders = new Set<number>();
    for (const item of items) {
      if (item.order >= upload.total_chapters || seenIds.has(item.id) || seenOrders.has(item.order)) {
        throw new HttpError(409, "CHAPTER_UPLOAD_MANIFEST_CONFLICT", "批次章节 ID 或顺序与上传清单冲突", { chapterId: item.id, order: item.order });
      }
      seenIds.add(item.id);
      seenOrders.add(item.order);
      const active = this.#db
        .prepare("SELECT revision FROM chapters WHERE document_id = ? AND id = ?")
        .get(documentId, item.id) as { revision: number } | undefined;
      if ((active?.revision ?? 0) !== item.baseRevision) {
        throw new HttpError(409, "CHAPTER_REVISION_CONFLICT", "章节已被其他修改更新", { chapterId: item.id, currentRevision: active?.revision ?? 0 });
      }
    }
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const insert = this.#db.prepare(
        "INSERT INTO chapter_upload_items(document_id, upload_id, chapter_id, title, volume_title, sort_order, content_hash, base_revision, revision, content_json, hidden) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(document_id, upload_id, chapter_id) DO UPDATE SET " +
          "title=excluded.title, volume_title=excluded.volume_title, sort_order=excluded.sort_order, content_hash=excluded.content_hash, " +
          "base_revision=excluded.base_revision, revision=excluded.revision, content_json=excluded.content_json, hidden=excluded.hidden",
      );
      const results = [];
      for (const item of items) {
        const active = this.#db
          .prepare("SELECT revision, content_hash, hidden FROM chapters WHERE document_id = ? AND id = ?")
          .get(documentId, item.id) as { revision: number; content_hash: string | null; hidden: number } | undefined;
        const unchanged =
          (active?.revision ?? 0) > 0 && active?.content_hash === item.hash;
        const revision = unchanged ? active.revision : item.baseRevision + 1;
        insert.run(documentId, uploadId, item.id, item.title, item.volumeTitle, item.order, item.hash, item.baseRevision, revision, JSON.stringify(item.content), active?.hidden ?? 0);
        results.push({ id: item.id, title: item.title, order: item.order, revision, status: unchanged ? "unchanged" as const : "saved" as const });
      }
      this.#db.exec("COMMIT");
      return results;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      if (error instanceof HttpError) throw error;
      throw new HttpError(409, "CHAPTER_UPLOAD_MANIFEST_CONFLICT", "批次与已暂存章节冲突");
    }
  }

  completeUpload(documentId: string, uploadId: string) {
    const upload = this.#db
      .prepare("SELECT manifest_hash, total_chapters, status, published_at FROM chapter_uploads WHERE document_id = ? AND id = ?")
      .get(documentId, uploadId) as { manifest_hash: string; total_chapters: number; status: string; published_at: string | null } | undefined;
    if (!upload) throw new HttpError(404, "CHAPTER_UPLOAD_NOT_FOUND", "上传会话不存在");
    if (upload.status === "published") return { uploadId, manifestHash: upload.manifest_hash, totalChapters: upload.total_chapters, publishedAt: upload.published_at! };
    if (upload.status !== "uploading") throw new HttpError(409, "CHAPTER_UPLOAD_NOT_ACTIVE", "上传会话正在由其他请求发布");
    this.#db.prepare("UPDATE chapter_uploads SET status='aborted' WHERE document_id=? AND id=? AND status='uploading'").run(documentId, uploadId);
    const reopen = () => this.#db.prepare("UPDATE chapter_uploads SET status='uploading' WHERE document_id=? AND id=? AND status='aborted'").run(documentId, uploadId);
    const items = this.#db
      .prepare("SELECT chapter_id, title, volume_title, sort_order, content_hash, base_revision FROM chapter_upload_items WHERE document_id = ? AND upload_id = ? ORDER BY sort_order")
      .all(documentId, uploadId) as Array<{ chapter_id: string; title: string; volume_title: string; sort_order: number; content_hash: string; base_revision: number }>;
    const invalidOrder = items.findIndex((item, index) => item.sort_order !== index);
    const manifestHash = createHash("sha256")
      .update(JSON.stringify(items.map((item) => ({ id: item.chapter_id, title: item.title, volumeTitle: item.volume_title, order: item.sort_order, hash: item.content_hash }))))
      .digest("hex");
    if (items.length !== upload.total_chapters || invalidOrder >= 0 || manifestHash !== upload.manifest_hash) {
      reopen();
      throw new HttpError(409, "CHAPTER_UPLOAD_INCOMPLETE", "上传章节数量、顺序或清单哈希不完整", { staged: items.length, expected: upload.total_chapters, invalidOrder });
    }
    const conflict = this.#db.prepare(
      "SELECT item.chapter_id, item.base_revision, COALESCE(chapter.revision, 0) AS current_revision " +
      "FROM chapter_upload_items item LEFT JOIN chapters chapter " +
      "ON chapter.document_id=item.document_id AND chapter.id=item.chapter_id " +
      "WHERE item.document_id=? AND item.upload_id=? " +
      "AND COALESCE(chapter.revision, 0)<>item.base_revision LIMIT 1",
    ).get(documentId, uploadId) as { chapter_id: string; base_revision: number; current_revision: number } | undefined;
    if (conflict) {
      reopen();
      throw new HttpError(409, "CHAPTER_REVISION_CONFLICT", "发布前章节基线发生变化", { chapterId: conflict.chapter_id, baseRevision: conflict.base_revision, currentRevision: conflict.current_revision });
    }
    const publishedAt = new Date().toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("UPDATE chapters SET sort_order = -sort_order - 1 WHERE document_id = ?").run(documentId);
      this.#db.prepare(
        "INSERT INTO chapters(id, title, volume_title, sort_order, document_id, revision, content_json, content_hash, updated_at, hidden) " +
          "SELECT chapter_id, title, volume_title, sort_order, document_id, revision, content_json, content_hash, ?, hidden " +
          "FROM chapter_upload_items WHERE document_id = ? AND upload_id = ? " +
          "ON CONFLICT(document_id, id) DO UPDATE SET title=excluded.title, volume_title=excluded.volume_title, sort_order=excluded.sort_order, revision=excluded.revision, content_json=excluded.content_json, content_hash=excluded.content_hash, updated_at=excluded.updated_at, hidden=excluded.hidden",
      ).run(publishedAt, documentId, uploadId);
      this.#db.prepare("DELETE FROM chapters WHERE document_id = ? AND id NOT IN (SELECT chapter_id FROM chapter_upload_items WHERE document_id = ? AND upload_id = ?)").run(documentId, documentId, uploadId);
      this.#db.prepare("UPDATE chapter_uploads SET status='published', published_at=? WHERE document_id=? AND id=? AND status='aborted'").run(publishedAt, documentId, uploadId);
      this.#db.exec("COMMIT");
      return { uploadId, manifestHash, totalChapters: items.length, publishedAt };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      reopen();
      throw error;
    }
  }

  /**
   * 批量保存章节正文（每批最多 20 章）。
   *
   * 与单章 saveChapter 语义一致，但把「预校验 → 写入」放进同一个事务：
   * 读入本批涉及章节的 owner/revision/order/content_hash 与目标文档的
   * order 占用情况，逐项校验目标 order 被批外章节占用、批内
   * 目标 order 重复与 baseRevision 过期；任一项失败整批抛 409（具体
   * chapterId 写入 details），不发生部分提交。
   *
   * 幂等语义：已存在记录 content_hash 与请求 hash 一致时返回 unchanged
   * 与当前 revision（含上次响应丢失后的重试），不重复递增版本号；其余
   * 项目在新事务内 UPSERT 并继续执行标准 Tiptap 清洗和 longTextBlock 转换。
   */
  saveChaptersBatch(
    documentId: string,
    items: Array<{
      id: string;
      title: string;
      order: number;
      content: TiptapDocument;
      hash: string;
      baseRevision: number;
    }>,
  ): Array<{ id: string; title: string; order: number; revision: number; status: "saved" | "unchanged" }> {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.#applyChaptersBatch(documentId, items);
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #applyChaptersBatch(
    documentId: string,
    items: Array<{
      id: string;
      title: string;
      order: number;
      content: TiptapDocument;
      hash: string;
      baseRevision: number;
    }>,
  ): Array<{ id: string; title: string; order: number; revision: number; status: "saved" | "unchanged" }> {
    const placeholders = items.map(() => "?").join(", ");
    const metadata = this.#db
      .prepare(
        "SELECT id, document_id, revision, sort_order, content_hash FROM chapters " +
          "WHERE document_id = ? AND id IN (" + placeholders + ")",
      )
      .all(documentId, ...items.map((item) => item.id)) as Array<{
      id: string;
      document_id: string;
      revision: number;
      sort_order: number;
      content_hash: string | null;
    }>;
    const byId = new Map(metadata.map((row) => [row.id, row]));
    const docOrders = this.#db
      .prepare("SELECT id, sort_order FROM chapters WHERE document_id = ?")
      .all(documentId) as Array<{ id: string; sort_order: number }>;
    const write: Array<{
      id: string;
      title: string;
      order: number;
      content: TiptapDocument;
      hash: string;
      revision: number;
    }> = [];
    const results: Array<{
      id: string;
      title: string;
      order: number;
      revision: number;
      status: "saved" | "unchanged";
    }> = [];
    const seenOrders = new Set<number>();
    for (const item of items) {
      const existing = byId.get(item.id);
      if (seenOrders.has(item.order)) {
        throw new HttpError(
          409,
          "CHAPTER_ORDER_CONFLICT",
          "批次内多个章节请求相同目标顺序",
          { chapterId: item.id },
        );
      }
      seenOrders.add(item.order);
      const occupied = docOrders.find(
        (row) => row.sort_order === item.order && row.id !== item.id,
      );
      if (occupied) {
        throw new HttpError(409, "CHAPTER_ORDER_CONFLICT", "目标顺序已被其他章节占用，禁止自动搬移线上章节", { chapterId: item.id, occupiedBy: occupied.id });
      }
      if (existing) {
        if (existing.revision > 0 && existing.content_hash === item.hash) {
          results.push({
            id: item.id,
            title: item.title,
            order: item.order,
            revision: existing.revision,
            status: "unchanged",
          });
          continue;
        }
        if (existing.revision !== item.baseRevision) {
          throw new HttpError(
            409,
            "CHAPTER_REVISION_CONFLICT",
            "章节已被其他修改更新，请重新对比差异",
            { chapterId: item.id, currentRevision: existing.revision },
          );
        }
      }
      const content = convertLongTextBlocksToChapters(
        item.content as unknown as JSONContent,
      ) as TiptapDocument;
      write.push({
        id: item.id,
        title: item.title,
        order: item.order,
        content,
        hash: item.hash,
        revision: (existing?.revision ?? 0) + 1,
      });
    }
    const now = new Date().toISOString();
    const upsert = this.#db.prepare(
      `INSERT INTO chapters(id, title, sort_order, document_id, revision, content_json, content_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(document_id, id) DO UPDATE SET
         title = excluded.title,
         sort_order = excluded.sort_order,
         revision = excluded.revision,
         content_json = excluded.content_json,
         content_hash = excluded.content_hash,
         updated_at = excluded.updated_at
       `,
    );
    for (const item of write) {
      upsert.run(
        item.id,
        item.title,
        item.order,
        documentId,
        item.revision,
        JSON.stringify(item.content),
        item.hash,
        now,
      );
      results.push({
        id: item.id,
        title: item.title,
        order: item.order,
        revision: item.revision,
        status: "saved",
      });
    }
    // 与请求顺序一致；unchanged 项已在前面按序填入。
    return results;
  }

  /**
   * 换序暂存：把移动章节放到全局唯一的临时 order，不发送正文。
   *
   * 幂等语义：当前顺序已经等于临时顺序且 revision 等于 baseRevision
   * （上次已成功暂存）时返回 unchanged 与当前 revision，不重复递增；
   * 上次响应丢失后的重试（revision = baseRevision + 1 且顺序一致）返回
   * staged 与当前 revision。临时 order 被批外章节占用、批内
   * 临时 order 重复或 baseRevision 过期时整批 409。
   */
  stageChapterReorder(
    documentId: string,
    items: Array<{ id: string; temporaryOrder: number; baseRevision: number }>,
  ): Array<{ id: string; revision: number; status: "staged" | "unchanged" }> {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const results = this.#applyChapterReorder(documentId, items);
      this.#db.exec("COMMIT");
      return results;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #applyChapterReorder(
    documentId: string,
    items: Array<{ id: string; temporaryOrder: number; baseRevision: number }>,
  ): Array<{ id: string; revision: number; status: "staged" | "unchanged" }> {
    const placeholders = items.map(() => "?").join(", ");
    const metadata = this.#db
      .prepare(
        "SELECT id, document_id, revision, sort_order FROM chapters " +
          "WHERE document_id = ? AND id IN (" + placeholders + ")",
      )
      .all(documentId, ...items.map((item) => item.id)) as Array<{
      id: string;
      document_id: string;
      revision: number;
      sort_order: number;
    }>;
    const byId = new Map(metadata.map((row) => [row.id, row]));
    const docOrders = this.#db
      .prepare("SELECT id, sort_order FROM chapters WHERE document_id = ?")
      .all(documentId) as Array<{ id: string; sort_order: number }>;
    const results: Array<{ id: string; revision: number; status: "staged" | "unchanged" }> =
      [];
    const seenOrders = new Set<number>();
    const update = this.#db.prepare(
      "UPDATE chapters SET sort_order = ?, revision = ?, updated_at = ? " +
        "WHERE id = ? AND document_id = ? AND revision = ?",
    );
    const now = new Date().toISOString();
    for (const item of items) {
      const existing = byId.get(item.id);
      if (seenOrders.has(item.temporaryOrder)) {
        throw new HttpError(
          409,
          "CHAPTER_ORDER_CONFLICT",
          "批次内多个章节请求相同临时顺序",
          { chapterId: item.id },
        );
      }
      seenOrders.add(item.temporaryOrder);
      const occupied = docOrders.find(
        (row) => row.sort_order === item.temporaryOrder && row.id !== item.id,
      );
      if (occupied) {
        throw new HttpError(
          409,
          "CHAPTER_ORDER_CONFLICT",
          "该临时顺序已被其他章节占用",
          { chapterId: item.id },
        );
      }
      if (!existing) {
        throw new HttpError(404, "CHAPTER_NOT_FOUND", "章节目录中不存在该章节", {
          chapterId: item.id,
        });
      }
      if (existing.sort_order === item.temporaryOrder) {
        if (
          existing.revision === item.baseRevision ||
          existing.revision === item.baseRevision + 1
        ) {
          results.push({
            id: item.id,
            revision: existing.revision,
            status: existing.revision === item.baseRevision ? "unchanged" : "staged",
          });
          continue;
        }
        throw new HttpError(
          409,
          "CHAPTER_REVISION_CONFLICT",
          "章节已被其他修改更新，请重新对比差异",
          { chapterId: item.id, currentRevision: existing.revision },
        );
      }
      if (existing.revision !== item.baseRevision) {
        throw new HttpError(
          409,
          "CHAPTER_REVISION_CONFLICT",
          "章节已被其他修改更新，请重新对比差异",
          { chapterId: item.id, currentRevision: existing.revision },
        );
      }
      const updated = update.run(
        item.temporaryOrder,
        item.baseRevision + 1,
        now,
        item.id,
        documentId,
        item.baseRevision,
      );
      if (updated.changes === 0) {
        throw new HttpError(
          409,
          "CHAPTER_REVISION_CONFLICT",
          "章节已被其他修改更新，请重新对比差异",
          { chapterId: item.id, currentRevision: existing.revision },
        );
      }
      results.push({
        id: item.id,
        revision: item.baseRevision + 1,
        status: "staged",
      });
    }
    return results;
  }

}
