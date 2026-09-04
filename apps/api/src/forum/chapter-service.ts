import type { DatabaseSync } from "node:sqlite";
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
    order: number;
    documentId: string;
    revision: number;
    savedAt: string;
    hidden: boolean;
  }> {
    const rows = this.#db
      .prepare(
        "SELECT id, title, sort_order, document_id, revision, updated_at, hidden " +
          "FROM chapters WHERE document_id = ? ORDER BY sort_order",
      )
      .all(documentId) as Array<{
      id: string;
      title: string;
      sort_order: number;
      document_id: string;
      revision: number;
      updated_at: string;
      hidden: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      order: row.sort_order,
      documentId: row.document_id,
      revision: row.revision,
      savedAt: row.updated_at,
      hidden: row.hidden === 1,
    }));
  }

  /** 读取分章上传的正文；目录占位行在首次保存前没有正文。 */
  chapterContent(documentId: string, chapterId: string) {
    const row = this.#db
      .prepare(
        "SELECT id, title, sort_order, document_id, revision, updated_at, hidden, content_json " +
          "FROM chapters WHERE id = ? AND document_id = ?",
      )
      .get(chapterId, documentId) as
      | {
          id: string;
          title: string;
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
    const exists = this.#db
      .prepare("SELECT 1 AS found FROM chapters WHERE id = ? AND document_id = ?")
      .get(chapterId, documentId) as { found: number } | undefined;
    if (!exists) return { id: chapterId, deleted: false };
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db
        .prepare(
          "UPDATE suggestions SET chapter_id = NULL " +
            "WHERE document_id = ? AND chapter_id = ?",
        )
        .run(documentId, chapterId);
      this.#db
        .prepare("DELETE FROM chapters WHERE id = ? AND document_id = ?")
        .run(chapterId, documentId);
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
    // 目标顺序被「其他服务器行」占用时不再整批 409：同一事务里先把它搬出
    // 目标顺序（搬到比本批所有请求顺序更高的空闲位，内容与版本保留），
    // 再写入新章——新文件上传模型下这种占用行基本是历史残留/占位行。
    const moves: Array<{ id: string; to: number }> = [];
    let nextFree = Math.max(
      -1,
      ...docOrders.map((row) => row.sort_order),
      ...items.map((item) => item.order),
    ) + 1;
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
        moves.push({ id: occupied.id, to: nextFree });
        nextFree += 1;
      }
      if (existing) {
        if (existing.content_hash === item.hash) {
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
    // 占用行先在同一事务内搬出目标顺序（顺序变化同样递增版本，行为与换序暂存一致）。
    if (moves.length > 0) {
      const moveOccurred = this.#db.prepare(
        "UPDATE chapters SET sort_order = ?, revision = revision + 1, updated_at = ? " +
          "WHERE id = ? AND document_id = ?",
      );
      for (const move of moves) {
        moveOccurred.run(move.to, now, move.id, documentId);
      }
    }
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
