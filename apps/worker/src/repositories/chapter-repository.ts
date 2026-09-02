import { ChapterSchema, type Chapter, type TiptapDocument } from "@ricetext/contracts";
import { sanitizeDocumentForWrite } from "@ricetext/server-core";
import { WorkerHttpError } from "../http-error";

type ChapterRow = {
  id: string;
  title: string;
  sort_order: number;
  document_id: string;
  revision: number;
  updated_at: string;
  hidden: number;
};

type ChapterRevisionRow = {
  revision: number;
};

function chapter(row: ChapterRow): Chapter {
  return ChapterSchema.parse({
    id: row.id,
    title: row.title,
    order: row.sort_order,
    documentId: row.document_id,
    revision: row.revision,
    savedAt: row.updated_at,
    hidden: row.hidden === 1,
  });
}

/** 章节目录仓储；所有写入同时校验 document_id，禁止跨文档复用章节 ID。 */
export class D1ChapterRepository {
  constructor(private readonly db: D1Database) {}

  private async requireDocument(documentId: string): Promise<void> {
    const found = await this.db
      .prepare("SELECT 1 AS found FROM documents WHERE id = ?")
      .bind(documentId)
      .first<{ found: number }>();
    if (!found) throw new WorkerHttpError(404, "DOCUMENT_NOT_FOUND", "文档不存在");
  }

  private async row(documentId: string, chapterId: string): Promise<ChapterRow | null> {
    return this.db
      .prepare(
        "SELECT id, title, sort_order, document_id, revision, updated_at, hidden " +
          "FROM chapters WHERE id = ? AND document_id = ?",
      )
      .bind(chapterId, documentId)
      .first<ChapterRow>();
  }

  async create(
    documentId: string,
    input: { title: string; order: number },
  ): Promise<{ value: Chapter; created: boolean }> {
    await this.requireDocument(documentId);
    const chapterId = "chapter-" + String(input.order);
    const now = new Date().toISOString();
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            "INSERT OR IGNORE INTO chapters(" +
              "id, title, sort_order, document_id, revision, updated_at, hidden" +
              ") VALUES (?, ?, ?, ?, 0, ?, 0)",
          )
          .bind(chapterId, input.title, input.order, documentId, now),
        this.db
          .prepare(
            "UPDATE chapters SET title = ?, sort_order = ? " +
              "WHERE id = ? AND document_id = ?",
          )
          .bind(input.title, input.order, chapterId, documentId),
      ]);
      const stored = await this.row(documentId, chapterId);
      if (!stored) {
        throw new WorkerHttpError(
          409,
          "CHAPTER_ORDER_CONFLICT",
          "该章节位置已被其他章节占用",
        );
      }
      return { value: chapter(stored), created: results[0]!.meta.changes > 0 };
    } catch (error) {
      if (error instanceof WorkerHttpError) throw error;
      const stored = await this.row(documentId, chapterId);
      if (stored) return { value: chapter(stored), created: false };
      throw new WorkerHttpError(
        409,
        "CHAPTER_ORDER_CONFLICT",
        "该章节位置已被其他章节占用",
      );
    }
  }

  async updateHidden(
    documentId: string,
    chapterId: string,
    hidden: boolean,
  ): Promise<Chapter> {
    await this.requireDocument(documentId);
    const result = await this.db
      .prepare("UPDATE chapters SET hidden = ? WHERE id = ? AND document_id = ?")
      .bind(hidden ? 1 : 0, chapterId, documentId)
      .run();
    if (result.meta.changes === 0) {
      throw new WorkerHttpError(404, "CHAPTER_NOT_FOUND", "章节目录中不存在该章节");
    }
    return chapter((await this.row(documentId, chapterId))!);
  }

  async delete(
    documentId: string,
    chapterId: string,
  ): Promise<{ id: string; deleted: boolean }> {
    await this.requireDocument(documentId);
    const results = await this.db.batch([
      this.db
        .prepare("UPDATE suggestions SET chapter_id = NULL WHERE chapter_id = ?")
        .bind(chapterId),
      this.db
        .prepare("DELETE FROM chapters WHERE id = ? AND document_id = ?")
        .bind(chapterId, documentId),
    ]);
    return { id: chapterId, deleted: results[1]!.meta.changes > 0 };
  }

  async syncHashes(
    documentId: string,
    local: readonly { id: string; hash: string }[],
  ): Promise<{ toUpdate: string[]; existing: string[] }> {
    await this.requireDocument(documentId);
    const result = await this.db
      .prepare("SELECT id, content_hash FROM chapters WHERE document_id = ?")
      .bind(documentId)
      .all<{ id: string; content_hash: string | null }>();
    const hashes = new Map(result.results.map((row) => [row.id, row.content_hash]));
    return {
      toUpdate: local.filter((item) => hashes.get(item.id) !== item.hash).map((item) => item.id),
      existing: [...hashes.keys()],
    };
  }

  async save(
    documentId: string,
    chapterId: string,
    input: {
      title: string;
      order: number;
      content: TiptapDocument;
      hash: string;
      baseRevision: number;
    },
  ): Promise<{ id: string; title: string; order: number; revision: number }> {
    await this.requireDocument(documentId);
    const content = sanitizeDocumentForWrite(input.content);
    const revision = input.baseRevision + 1;
    const now = new Date().toISOString();
    try {
      const row = await this.db
        .prepare(
          "INSERT INTO chapters(" +
            "id, title, sort_order, document_id, revision, content_json, content_hash, updated_at, hidden" +
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0) " +
            "ON CONFLICT(id) DO UPDATE SET " +
            "title = excluded.title, sort_order = excluded.sort_order, " +
            "revision = excluded.revision, content_json = excluded.content_json, " +
            "content_hash = excluded.content_hash, updated_at = excluded.updated_at " +
            "WHERE chapters.document_id = excluded.document_id AND chapters.revision = ? " +
            "RETURNING id, title, sort_order, revision",
        )
        .bind(
          chapterId,
          input.title,
          input.order,
          documentId,
          revision,
          JSON.stringify(content),
          input.hash,
          now,
          input.baseRevision,
        )
        .first<{ id: string; title: string; sort_order: number; revision: number }>();
      if (row) {
        return { id: row.id, title: row.title, order: row.sort_order, revision: row.revision };
      }
    } catch {
      const current = await this.db
        .prepare("SELECT revision FROM chapters WHERE id = ? AND document_id = ?")
        .bind(chapterId, documentId)
        .first<ChapterRevisionRow>();
      if (current && current.revision !== input.baseRevision) {
        throw new WorkerHttpError(
          409,
          "CHAPTER_REVISION_CONFLICT",
          "章节已被其他修改更新，请重新对比差异",
          { currentRevision: current.revision, baseRevision: input.baseRevision },
        );
      }
      throw new WorkerHttpError(
        409,
        "CHAPTER_ORDER_CONFLICT",
        "该章节位置已被其他章节占用",
      );
    }

    const current = await this.db
      .prepare("SELECT revision FROM chapters WHERE id = ? AND document_id = ?")
      .bind(chapterId, documentId)
      .first<ChapterRevisionRow>();
    throw new WorkerHttpError(
      409,
      "CHAPTER_REVISION_CONFLICT",
      "章节已被其他修改更新，请重新对比差异",
      {
        currentRevision: current?.revision ?? 0,
        baseRevision: input.baseRevision,
      },
    );
  }
}
