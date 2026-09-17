import {
  ChapterSchema,
  DocumentEnvelopeSchema,
  RevisionPageSchema,
  type Chapter,
  type DocumentEnvelope,
  type RevisionPage,
} from "@ricetext/contracts";
import { describeStepsJson, type StepJson } from "@ricetext/document-core";
import { repairDocumentForRead } from "@ricetext/server-core";
import { WorkerHttpError } from "../http-error";
import { type ChapterRevisionOperation } from "./chapter-ledger";

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
  chapter_document_revision?: number | null;
  schema_version: number;
  steps_json: string | null;
  author_id: string;
  author_name: string | null;
  operation: ChapterRevisionOperation;
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
  latest_revision?: number | null;
};

const revisionSummary: Record<RevisionRow["operation"], string> = {
  seed: "创建初始版本",
  update: "保存正文修改",
  rollback: "回退历史版本",
  suggestion: "合并已审核纠错建议",
  steps: "应用增量编辑",
  import: "导入并发布章节",
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

  /** 把章节内容版本号映射到内部整篇快照号；独立章节版本没有整篇快照。 */
  async documentRevisionForChapter(
    documentId: string,
    chapterId: string,
    chapterRevision: number,
  ): Promise<number> {
    const row = await this.ledgerRow(documentId, chapterId, chapterRevision);
    if (row.document_revision === null) {
      throw new WorkerHttpError(404, "REVISION_NOT_FOUND", "该章节版本没有整篇快照");
    }
    return row.document_revision;
  }

  private async ledgerRow(
    documentId: string,
    chapterId: string,
    chapterRevision: number,
  ): Promise<{
    chapter_revision: number;
    document_revision: number | null;
    schema_version: number;
    content_json: string | null;
    created_at: string;
  }> {
    const row = await this.db
      .prepare(
        "SELECT chapter_revision, document_revision, schema_version, content_json, created_at " +
          "FROM chapter_revisions WHERE document_id = ? AND chapter_id = ? AND chapter_revision = ?",
      )
      .bind(documentId, chapterId, chapterRevision)
      .first<{
        chapter_revision: number;
        document_revision: number | null;
        schema_version: number;
        content_json: string | null;
        created_at: string;
      }>();
    if (!row) throw new WorkerHttpError(404, "REVISION_NOT_FOUND", "章节版本不存在");
    return row;
  }

  /**
   * 读取章节版本快照。
   *
   * `origin` 表明快照来源：整篇不可变快照（document）或账本里的独立章节快照（chapter）。
   * 调用方据此决定是否套用隐藏章节投影——独立章节快照没有章节标题边界。
   */
  async chapterRevision(
    documentId: string,
    chapterId: string,
    chapterRevision: number,
  ): Promise<{ envelope: DocumentEnvelope; origin: "document" | "chapter" }> {
    const row = await this.ledgerRow(documentId, chapterId, chapterRevision);
    if (row.document_revision !== null) {
      return { envelope: await this.revision(documentId, row.document_revision), origin: "document" };
    }
    if (!row.content_json) {
      throw new WorkerHttpError(404, "REVISION_NOT_FOUND", "该章节版本没有正文快照");
    }
    const document = await this.document(documentId);
    return {
      origin: "chapter",
      envelope: DocumentEnvelopeSchema.parse({
        id: document.id,
        title: document.title,
        schemaVersion: row.schema_version,
        revision: document.revision,
        savedAt: row.created_at,
        content: repairDocumentForRead(JSON.parse(row.content_json)),
      }),
    };
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
      // 章节历史只读账本：不再扫描整篇快照，也不从 request_json 反推归属。
      const sql = [
        "SELECT ledger.chapter_revision AS revision, ledger.chapter_revision,",
        "ledger.document_revision AS chapter_document_revision,",
        "ledger.target_chapter_revision AS chapter_target_revision,",
        "ledger.schema_version, ledger.steps_json, ledger.author_id,",
        "user.name AS author_name, ledger.operation, ledger.created_at",
        "FROM chapter_revisions ledger",
        "LEFT JOIN users user ON user.id = ledger.author_id",
        "WHERE ledger.document_id = ? AND ledger.chapter_id = ?",
        "AND ledger.chapter_revision < ?",
        "ORDER BY ledger.chapter_revision DESC LIMIT ?",
      ].join(" ");
      rows = (
        await this.db
          .prepare(sql)
          .bind(documentId, chapterId, cursorRevision, limit + 1)
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
          origin: chapterId && row.chapter_document_revision === null ? "chapter" : "document",
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
        "SELECT chapters.id, chapters.title, chapters.volume_title, chapters.sort_order, " +
          "chapters.document_id, chapters.revision, chapters.content_json, chapters.updated_at, " +
          "chapters.hidden, chapter_ledger.latest_revision FROM chapters " +
          "LEFT JOIN (SELECT document_id, chapter_id, MAX(chapter_revision) AS latest_revision " +
          "FROM chapter_revisions GROUP BY document_id, chapter_id) chapter_ledger " +
          "ON chapter_ledger.document_id = chapters.document_id " +
          "AND chapter_ledger.chapter_id = chapters.id " +
          "WHERE chapters.document_id = ? ORDER BY chapters.sort_order",
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
        // 账本只在有内容版本时才有行；上传/历史数据没有账本行时回退到章节行 revision，
        // 避免对外把已有正文的章节显示成“第 0 版”。
        latestRevision: row.latest_revision ?? row.revision,
        hasContent: row.content_json !== null,
        savedAt: row.updated_at,
        hidden: row.hidden === 1,
      }),
    );
  }
}
