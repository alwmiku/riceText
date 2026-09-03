import {
  ChapterSchema,
  DocumentEnvelopeSchema,
  RevisionPageSchema,
  type Chapter,
  type DocumentEnvelope,
  type RevisionPage,
} from "@ricetext/contracts";
import {
  describeStepsJson,
  splitDocumentByChapters,
  type JSONContent,
  type StepJson,
} from "@ricetext/document-core";
import { repairDocumentForRead } from "@ricetext/server-core";
import { WorkerHttpError } from "../http-error";

type DocumentRow = {
  id: string;
  title: string;
  schema_version: number;
  revision: number;
  content_json: string;
  created_at: string;
};

type RevisionRow = {
  revision: number;
  schema_version: number;
  steps_json: string | null;
  author_id: string;
  author_name: string | null;
  operation: "seed" | "update" | "rollback" | "suggestion" | "steps";
  target_revision: number | null;
  created_at: string;
};

type ChapterRow = {
  id: string;
  title: string;
  sort_order: number;
  document_id: string;
  revision: number;
  updated_at: string;
  hidden: number;
};

const revisionSummary: Record<RevisionRow["operation"], string> = {
  seed: "创建初始版本",
  update: "保存正文修改",
  rollback: "回退历史版本",
  suggestion: "合并已审核纠错建议",
  steps: "应用增量编辑",
};

function envelope(row: DocumentRow): DocumentEnvelope {
  return DocumentEnvelopeSchema.parse({
    id: row.id,
    title: row.title,
    schemaVersion: row.schema_version,
    revision: row.revision,
    savedAt: row.created_at,
    content: repairDocumentForRead(JSON.parse(row.content_json)),
  });
}

/** 文档只读仓储；修订不可变，当前态由 documents.current_revision 指针解析。 */
export class D1ReadRepository {
  constructor(private readonly db: D1Database) {}

  async document(documentId: string): Promise<DocumentEnvelope> {
    const sql = [
      "SELECT document.id, document.title, revision.schema_version,",
      "revision.revision, revision.content_json, revision.created_at",
      "FROM documents document",
      "JOIN document_revisions revision",
      "ON revision.document_id = document.id",
      "AND revision.revision = document.current_revision",
      "WHERE document.id = ?",
    ].join(" ");
    const row = await this.db.prepare(sql).bind(documentId).first<DocumentRow>();
    if (!row) throw new WorkerHttpError(404, "DOCUMENT_NOT_FOUND", "文档不存在");
    return envelope(row);
  }

  async revision(documentId: string, revision: number): Promise<DocumentEnvelope> {
    const sql = [
      "SELECT document.id, document.title, revision.schema_version,",
      "revision.revision, revision.content_json, revision.created_at",
      "FROM documents document",
      "JOIN document_revisions revision ON revision.document_id = document.id",
      "WHERE document.id = ? AND revision.revision = ?",
    ].join(" ");
    const row = await this.db.prepare(sql).bind(documentId, revision).first<DocumentRow>();
    if (!row) throw new WorkerHttpError(404, "REVISION_NOT_FOUND", "文档或版本不存在");
    return envelope(row);
  }

  async revisions(
    documentId: string,
    cursor: string | undefined,
    limit: number,
    chapterId: string | undefined,
  ): Promise<RevisionPage> {
    const exists = await this.db
      .prepare("SELECT 1 AS found FROM documents WHERE id = ?")
      .bind(documentId)
      .first<{ found: number }>();
    if (!exists) throw new WorkerHttpError(404, "DOCUMENT_NOT_FOUND", "文档不存在");

    const cursorRevision = cursor ? Number(cursor) : Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(cursorRevision) || cursorRevision < 1) {
      throw new WorkerHttpError(422, "INVALID_CURSOR", "版本 cursor 必须是正整数 revision");
    }
    let includeSeed = 0;
    if (chapterId) {
      const chapter = await this.db
        .prepare("SELECT sort_order FROM chapters WHERE document_id = ? AND id = ?")
        .bind(documentId, chapterId)
        .first<{ sort_order: number }>();
      if (!chapter) throw new WorkerHttpError(404, "CHAPTER_NOT_FOUND", "章节不存在");
      const seed = await this.db
        .prepare(
          "SELECT content_json FROM document_revisions " +
            "WHERE document_id = ? AND operation = 'seed' ORDER BY revision LIMIT 1",
        )
        .bind(documentId)
        .first<{ content_json: string }>();
      if (seed) {
        const content = repairDocumentForRead(JSON.parse(seed.content_json));
        includeSeed = splitDocumentByChapters(content as unknown as JSONContent).chapters[
          chapter.sort_order
        ]
          ? 1
          : 0;
      }
    }
    const chapterClause = chapterId
      ? [
          "AND ((revision.operation = 'seed' AND ? = 1) OR EXISTS (",
          "SELECT 1 FROM document_mutations mutation",
          "WHERE mutation.document_id = revision.document_id",
          "AND mutation.revision = revision.revision",
          "AND json_extract(mutation.request_json, '$.chapterId') = ?))",
        ].join(" ")
      : "";
    const bindings: (string | number)[] = [documentId, cursorRevision];
    if (chapterId) bindings.push(includeSeed, chapterId);
    bindings.push(limit + 1);
    const sql = [
      "SELECT revision.revision, revision.schema_version, revision.steps_json,",
      "revision.author_id, user.name AS author_name, revision.operation,",
      "revision.target_revision, revision.created_at",
      "FROM document_revisions revision",
      "LEFT JOIN users user ON user.id = revision.author_id",
      "WHERE revision.document_id = ? AND revision.revision < ?",
      chapterClause,
      "ORDER BY revision.revision DESC LIMIT ?",
    ].join(" ");
    const result = await this.db.prepare(sql).bind(...bindings).all<RevisionRow>();
    const hasMore = result.results.length > limit;
    const page = result.results.slice(0, limit);
    return RevisionPageSchema.parse({
      items: page.map((row) => ({
        revision: row.revision,
        schemaVersion: row.schema_version,
        savedAt: row.created_at,
        authorId: row.author_id,
        authorName: row.author_name ?? row.author_id,
        operation: row.operation,
        summary:
          row.operation === "rollback" && row.target_revision !== null
            ? "回退到版本 " + String(row.target_revision)
            : revisionSummary[row.operation],
        stepsSummary: row.steps_json
          ? describeStepsJson(JSON.parse(row.steps_json) as StepJson[])
          : null,
        targetRevision: row.target_revision,
      })),
      pageInfo: { nextCursor: hasMore ? String(page.at(-1)!.revision) : null },
    });
  }

  async chapters(documentId: string): Promise<Chapter[]> {
    const result = await this.db
      .prepare(
        "SELECT id, title, sort_order, document_id, revision, updated_at, hidden " +
          "FROM chapters WHERE document_id = ? ORDER BY sort_order",
      )
      .bind(documentId)
      .all<ChapterRow>();
    return result.results.map((row) =>
      ChapterSchema.parse({
        id: row.id,
        title: row.title,
        order: row.sort_order,
        documentId: row.document_id,
        revision: row.revision,
        savedAt: row.updated_at,
        hidden: row.hidden === 1,
      }),
    );
  }
}
