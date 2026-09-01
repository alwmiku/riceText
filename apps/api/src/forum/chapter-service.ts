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
  }> {
    const rows = this.#db
      .prepare(
        "SELECT id, title, sort_order, document_id, revision FROM chapters ORDER BY sort_order",
      )
      .all() as Array<{
      id: string;
      title: string;
      sort_order: number;
      document_id: string;
      revision: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      order: row.sort_order,
      documentId: row.document_id,
      revision: row.revision,
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
        `INSERT INTO chapters(id, title, sort_order, document_id, revision, content_json, content_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           sort_order = excluded.sort_order,
           revision = excluded.revision,
           content_json = excluded.content_json,
           content_hash = excluded.content_hash`,
      )
      .run(
        chapterId,
        input.title,
        input.order,
        documentId,
        revision,
        JSON.stringify(input.content),
        input.hash,
      );
    return { id: chapterId, title: input.title, order: input.order, revision };
  }
}
