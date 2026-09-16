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
  chapter_revision?: number;
  chapter_target_revision?: number | null;
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
  volume_title: string;
  sort_order: number;
  document_id: string;
  revision: number;
  content_json: string | null;
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

  /** 判断初始快照是否真实包含目标章节；目录位置相同不能视为同一章节。 */
  private async seedContainsChapter(documentId: string, chapterId: string): Promise<number> {
    const chapter = await this.db
      .prepare("SELECT 1 AS found FROM chapters WHERE document_id = ? AND id = ?")
      .bind(documentId, chapterId)
      .first<{ found: number }>();
    if (!chapter) throw new WorkerHttpError(404, "CHAPTER_NOT_FOUND", "章节不存在");
    const seed = await this.db
      .prepare(
        "SELECT content_json FROM document_revisions " +
          "WHERE document_id = ? AND operation = 'seed' ORDER BY revision LIMIT 1",
      )
      .bind(documentId)
      .first<{ content_json: string }>();
    if (!seed) return 0;
    const content = repairDocumentForRead(JSON.parse(seed.content_json));
    return splitDocumentByChapters(content as unknown as JSONContent).chapters.some(
      (chapterSection) => chapterSection.id === chapterId,
    )
      ? 1
      : 0;
  }

  /** 把章节内版本号映射到内部文档快照号；全局号不会暴露给章节历史调用方。 */
  async documentRevisionForChapter(
    documentId: string,
    chapterId: string,
    chapterRevision: number,
  ): Promise<number> {
    const includeSeed = await this.seedContainsChapter(documentId, chapterId);
    const row = await this.db
      .prepare(
        [
          "WITH scoped AS (",
          "SELECT revision.revision AS document_revision,",
          "ROW_NUMBER() OVER (ORDER BY revision.revision) AS chapter_revision",
          "FROM document_revisions revision",
          "WHERE revision.document_id = ?",
          "AND ((revision.operation = 'seed' AND ? = 1) OR EXISTS (",
          "SELECT 1 FROM document_mutations mutation",
          "WHERE mutation.document_id = revision.document_id",
          "AND mutation.revision = revision.revision",
          "AND json_extract(mutation.request_json, '$.chapterId') = ?))",
          ") SELECT document_revision FROM scoped WHERE chapter_revision = ?",
        ].join(" "),
      )
      .bind(documentId, includeSeed, chapterId, chapterRevision)
      .first<{ document_revision: number }>();
    if (!row) throw new WorkerHttpError(404, "REVISION_NOT_FOUND", "章节版本不存在");
    return row.document_revision;
  }

  async revision(
    documentId: string,
    revision: number,
    chapterId?: string,
  ): Promise<DocumentEnvelope> {
    const documentRevision = chapterId
      ? await this.documentRevisionForChapter(documentId, chapterId, revision)
      : revision;
    const sql = [
      "SELECT document.id, document.title, revision.schema_version,",
      "revision.revision, revision.content_json, revision.created_at",
      "FROM documents document",
      "JOIN document_revisions revision ON revision.document_id = document.id",
      "WHERE document.id = ? AND revision.revision = ?",
    ].join(" ");
    const row = await this.db.prepare(sql).bind(documentId, documentRevision).first<DocumentRow>();
    if (!row) throw new WorkerHttpError(404, "REVISION_NOT_FOUND", "文档或修订不存在");
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
      throw new WorkerHttpError(422, "INVALID_CURSOR", "版本 cursor 必须是正整数");
    }

    let rows: RevisionRow[];
    if (chapterId) {
      const includeSeed = await this.seedContainsChapter(documentId, chapterId);
      const sql = [
        "WITH scoped AS (",
        "SELECT revision.revision AS document_revision, revision.schema_version,",
        "revision.steps_json, revision.author_id, user.name AS author_name,",
        "revision.operation, revision.target_revision, revision.created_at,",
        "ROW_NUMBER() OVER (ORDER BY revision.revision) AS chapter_revision,",
        "(SELECT CAST(json_extract(mutation.request_json, '$.targetRevision') AS INTEGER)",
        "FROM document_mutations mutation",
        "WHERE mutation.document_id = revision.document_id",
        "AND mutation.revision = revision.revision LIMIT 1) AS chapter_target_revision",
        "FROM document_revisions revision",
        "LEFT JOIN users user ON user.id = revision.author_id",
        "WHERE revision.document_id = ?",
        "AND ((revision.operation = 'seed' AND ? = 1) OR EXISTS (",
        "SELECT 1 FROM document_mutations mutation",
        "WHERE mutation.document_id = revision.document_id",
        "AND mutation.revision = revision.revision",
        "AND json_extract(mutation.request_json, '$.chapterId') = ?))",
        ") SELECT document_revision AS revision, chapter_revision, chapter_target_revision,",
        "schema_version, steps_json, author_id, author_name, operation, target_revision, created_at",
        "FROM scoped WHERE chapter_revision < ? ORDER BY chapter_revision DESC LIMIT ?",
      ].join(" ");
      rows = (
        await this.db
          .prepare(sql)
          .bind(documentId, includeSeed, chapterId, cursorRevision, limit + 1)
          .all<RevisionRow>()
      ).results;
    } else {
      const sql = [
        "SELECT revision.revision, revision.schema_version, revision.steps_json,",
        "revision.author_id, user.name AS author_name, revision.operation,",
        "revision.target_revision, revision.created_at",
        "FROM document_revisions revision",
        "LEFT JOIN users user ON user.id = revision.author_id",
        "WHERE revision.document_id = ? AND revision.revision < ?",
        "ORDER BY revision.revision DESC LIMIT ?",
      ].join(" ");
      rows = (
        await this.db
          .prepare(sql)
          .bind(documentId, cursorRevision, limit + 1)
          .all<RevisionRow>()
      ).results;
    }

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return RevisionPageSchema.parse({
      items: page.map((row) => {
        const visibleRevision = chapterId ? row.chapter_revision! : row.revision;
        const targetRevision = chapterId
          ? (row.chapter_target_revision ?? null)
          : row.target_revision;
        return {
          revision: visibleRevision,
          schemaVersion: row.schema_version,
          savedAt: row.created_at,
          authorId: row.author_id,
          authorName: row.author_name ?? row.author_id,
          operation: row.operation,
          summary:
            row.operation === "rollback" && targetRevision !== null
              ? "回退到章节版本 " + String(targetRevision)
              : revisionSummary[row.operation],
          stepsSummary: row.steps_json
            ? describeStepsJson(JSON.parse(row.steps_json) as StepJson[])
            : null,
          targetRevision,
        };
      }),
      pageInfo: {
        nextCursor: hasMore
          ? String(chapterId ? page.at(-1)!.chapter_revision : page.at(-1)!.revision)
          : null,
      },
    });
  }

  async chapters(documentId: string): Promise<Chapter[]> {
    const result = await this.db
      .prepare(
        "SELECT id, title, volume_title, sort_order, document_id, revision, content_json, updated_at, hidden " +
          "FROM chapters WHERE document_id = ? ORDER BY sort_order",
      )
      .bind(documentId)
      .all<ChapterRow>();
    return result.results.map((row) =>
      ChapterSchema.parse({
        id: row.id,
        title: row.title,
        volumeTitle: row.volume_title,
        order: row.sort_order,
        documentId: row.document_id,
        revision: row.revision,
        hasContent: row.content_json !== null,
        savedAt: row.updated_at,
        hidden: row.hidden === 1,
      }),
    );
  }
}
