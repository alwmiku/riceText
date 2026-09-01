import type { DatabaseSync } from "node:sqlite";
import type { TiptapDocument } from "@ricetext/contracts";
import { HttpError } from "../errors.js";

export class ChapterService {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** 章节目录。 */
  chapters(): Array<{
    id: string;
    title: string;
    order: number;
    documentId: string;
    revision: number;
    savedAt: string;
  }> {
    const rows = this.#db
      .prepare(
        "SELECT id, title, sort_order, document_id, revision, updated_at FROM chapters ORDER BY sort_order",
      )
      .all() as Array<{
      id: string;
      title: string;
      sort_order: number;
      document_id: string;
      revision: number;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      order: row.sort_order,
      documentId: row.document_id,
      revision: row.revision,
      savedAt: row.updated_at,
    }));
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
  } {
    const id = `chapter-${input.order}`;
    const now = new Date().toISOString();
    this.#db
      .prepare(
        `INSERT INTO chapters(id, title, sort_order, document_id, revision, updated_at)
         VALUES (?, ?, ?, ?, 0, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           sort_order = excluded.sort_order,
           document_id = excluded.document_id`,
      )
      .run(id, input.title, input.order, documentId, now);
    const row = this.#db
      .prepare(
        "SELECT id, title, sort_order, document_id, revision, updated_at FROM chapters WHERE id = ? AND document_id = ?",
      )
      .get(id, documentId) as {
      id: string;
      title: string;
      sort_order: number;
      document_id: string;
      revision: number;
      updated_at: string;
    };
    return {
      id: row.id,
      title: row.title,
      order: row.sort_order,
      documentId: row.document_id,
      revision: row.revision,
      savedAt: row.updated_at,
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
          "UPDATE suggestions SET chapter_id = NULL WHERE chapter_id = ?",
        )
        .run(chapterId);
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
      .prepare("SELECT revision FROM chapters WHERE id = ? AND document_id = ?")
      .get(chapterId, documentId) as { revision: number } | undefined;
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
    const revision = (existing?.revision ?? 0) + 1;
    this.#db
      .prepare(
        `INSERT INTO chapters(id, title, sort_order, document_id, revision, content_json, content_hash, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           sort_order = excluded.sort_order,
           revision = excluded.revision,
           content_json = excluded.content_json,
           content_hash = excluded.content_hash,
           updated_at = excluded.updated_at`,
      )
      .run(
        chapterId,
        input.title,
        input.order,
        documentId,
        revision,
        JSON.stringify(input.content),
        input.hash,
        new Date().toISOString(),
      );
    return { id: chapterId, title: input.title, order: input.order, revision };
  }
}
