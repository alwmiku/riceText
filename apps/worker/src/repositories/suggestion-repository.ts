import {
  SuggestionBatchSchema,
  SuggestionSchema,
  type ForumUser,
  type Suggestion,
  type SuggestionBatch,
  type TiptapDocument,
} from "@ricetext/contracts";
import { diffDocuments, type JSONContent } from "@ricetext/document-core";
import {
  mergeSuggestionBatch,
  repairDocumentForRead,
  replaceFirstText,
  validateSuggestionBatch,
} from "@ricetext/server-core";
import { WorkerHttpError } from "../http-error";
import { D1ReadRepository } from "./read-repository";
import { D1WriteRepository } from "./write-repository";

type SuggestionRow = {
  id: string;
  document_id: string;
  chapter_id: string | null;
  chapter_title: string;
  line_no: number;
  line_text: string;
  from_text: string;
  to_text: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  author_id: string;
  reviewer_id: string | null;
  created_at: string;
};

type SuggestionBatchRow = {
  id: string;
  document_id: string;
  chapter_id: string;
  chapter_title: string;
  base_revision: number;
  before_content_json: string;
  after_content_json: string;
  steps_json: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  author_id: string;
  reviewer_id: string | null;
  created_at: string;
};

function mapSuggestion(row: SuggestionRow): Suggestion {
  return SuggestionSchema.parse({
    id: row.id,
    documentId: row.document_id,
    chapterId: row.chapter_id ?? "",
    chapterTitle: row.chapter_title,
    lineNo: row.line_no,
    lineText: row.line_text,
    fromText: row.from_text,
    toText: row.to_text,
    reason: row.reason,
    status: row.status,
    authorId: row.author_id,
    reviewerId: row.reviewer_id,
    createdAt: row.created_at,
  });
}

function mapBatch(row: SuggestionBatchRow): SuggestionBatch {
  return SuggestionBatchSchema.parse({
    id: row.id,
    documentId: row.document_id,
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    baseRevision: row.base_revision,
    beforeContent: repairDocumentForRead(JSON.parse(row.before_content_json)),
    afterContent: repairDocumentForRead(JSON.parse(row.after_content_json)),
    steps: JSON.parse(row.steps_json),
    reason: row.reason,
    status: row.status,
    authorId: row.author_id,
    reviewerId: row.reviewer_id,
    createdAt: row.created_at,
  });
}

/** 校订建议仓储；审核 guard、正文修订和建议状态必须作为一个原子结果提交。 */
export class D1SuggestionRepository {
  private readonly reads: D1ReadRepository;
  private readonly writes: D1WriteRepository;

  constructor(private readonly db: D1Database) {
    this.reads = new D1ReadRepository(db);
    this.writes = new D1WriteRepository(db);
  }

  async suggestions(documentId: string, principal: ForumUser): Promise<Suggestion[]> {
    await this.reads.document(documentId);
    const editor = await this.canEdit(documentId, principal);
    const sql = editor
      ? "SELECT * FROM suggestions WHERE document_id = ? ORDER BY created_at DESC"
      : "SELECT * FROM suggestions WHERE document_id = ? AND author_id = ? ORDER BY created_at DESC";
    const statement = this.db.prepare(sql);
    const result = await (editor
      ? statement.bind(documentId)
      : statement.bind(documentId, principal.id)
    ).all<SuggestionRow>();
    return result.results.map(mapSuggestion);
  }

  async batches(documentId: string, principal: ForumUser): Promise<SuggestionBatch[]> {
    await this.reads.document(documentId);
    const editor = await this.canEdit(documentId, principal);
    const sql = editor
      ? "SELECT * FROM suggestion_batches WHERE document_id = ? ORDER BY created_at DESC"
      : "SELECT * FROM suggestion_batches WHERE document_id = ? AND author_id = ? ORDER BY created_at DESC";
    const statement = this.db.prepare(sql);
    const result = await (editor
      ? statement.bind(documentId)
      : statement.bind(documentId, principal.id)
    ).all<SuggestionBatchRow>();
    return result.results.map(mapBatch);
  }

  async createSuggestion(
    documentId: string,
    input: {
      fromText: string;
      toText: string;
      reason: string;
      chapterId: string;
      chapterTitle: string;
      lineNo: number;
      lineText: string;
    },
    principal: ForumUser,
  ): Promise<Suggestion> {
    await this.reads.document(documentId);
    if (input.chapterId) {
      const chapter = await this.db
        .prepare("SELECT 1 AS found FROM chapters WHERE id = ? AND document_id = ?")
        .bind(input.chapterId, documentId)
        .first<{ found: number }>();
      if (!chapter) throw new WorkerHttpError(404, "CHAPTER_NOT_FOUND", "章节不存在");
    }
    const row: SuggestionRow = {
      id: crypto.randomUUID(),
      document_id: documentId,
      chapter_id: input.chapterId || null,
      chapter_title: input.chapterTitle,
      line_no: input.lineNo,
      line_text: input.lineText,
      from_text: input.fromText,
      to_text: input.toText,
      reason: input.reason,
      status: "pending",
      author_id: principal.id,
      reviewer_id: null,
      created_at: new Date().toISOString(),
    };
    await this.db
      .prepare(
        "INSERT INTO suggestions(" +
          "id, document_id, chapter_id, chapter_title, line_no, line_text, from_text, to_text, " +
          "reason, status, author_id, reviewer_id, created_at, reviewed_at" +
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?, NULL)",
      )
      .bind(
        row.id,
        row.document_id,
        row.chapter_id,
        row.chapter_title,
        row.line_no,
        row.line_text,
        row.from_text,
        row.to_text,
        row.reason,
        row.author_id,
        row.created_at,
      )
      .run();
    return mapSuggestion(row);
  }

  async createBatch(
    documentId: string,
    input: {
      baseRevision: number;
      chapterId: string;
      chapterTitle: string;
      beforeContent: TiptapDocument;
      afterContent: TiptapDocument;
      steps: Array<Record<string, unknown>>;
      reason: string;
    },
    principal: ForumUser,
  ): Promise<SuggestionBatch> {
    const current = await this.reads.document(documentId);
    if (current.revision !== input.baseRevision) {
      throw new WorkerHttpError(409, "REVISION_CONFLICT", "正文已变化，请重新编辑后提交", {
        currentRevision: current.revision,
        baseRevision: input.baseRevision,
      });
    }
    validateSuggestionBatch(current.content, input);
    const row: SuggestionBatchRow = {
      id: crypto.randomUUID(),
      document_id: documentId,
      chapter_id: input.chapterId,
      chapter_title: input.chapterTitle,
      base_revision: input.baseRevision,
      before_content_json: JSON.stringify(input.beforeContent),
      after_content_json: JSON.stringify(input.afterContent),
      steps_json: JSON.stringify(input.steps),
      reason: input.reason,
      status: "pending",
      author_id: principal.id,
      reviewer_id: null,
      created_at: new Date().toISOString(),
    };
    await this.db
      .prepare(
        "INSERT INTO suggestion_batches(" +
          "id, document_id, chapter_id, chapter_title, base_revision, before_content_json, " +
          "after_content_json, steps_json, reason, status, author_id, reviewer_id, created_at, reviewed_at" +
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?, NULL)",
      )
      .bind(
        row.id,
        row.document_id,
        row.chapter_id,
        row.chapter_title,
        row.base_revision,
        row.before_content_json,
        row.after_content_json,
        row.steps_json,
        row.reason,
        row.author_id,
        row.created_at,
      )
      .run();
    return mapBatch(row);
  }

  async suggestionDocument(suggestionId: string): Promise<string> {
    const row = await this.db
      .prepare("SELECT document_id FROM suggestions WHERE id = ?")
      .bind(suggestionId)
      .first<{ document_id: string }>();
    if (!row) throw new WorkerHttpError(404, "SUGGESTION_NOT_FOUND", "纠错建议不存在");
    return row.document_id;
  }

  async batchDocument(batchId: string): Promise<string> {
    const row = await this.db
      .prepare("SELECT document_id FROM suggestion_batches WHERE id = ?")
      .bind(batchId)
      .first<{ document_id: string }>();
    if (!row) {
      throw new WorkerHttpError(404, "SUGGESTION_BATCH_NOT_FOUND", "批量校订不存在");
    }
    return row.document_id;
  }

  private async reject(
    kind: "single" | "batch",
    id: string,
    reviewerId: string,
  ): Promise<void> {
    const table = kind === "batch" ? "suggestion_batches" : "suggestions";
    const now = new Date().toISOString();
    try {
      await this.db.batch([
        this.db
          .prepare(
            "INSERT INTO suggestion_review_guards(" +
              "suggestion_kind, suggestion_id, decision, reviewer_id, created_at" +
              ") VALUES (?, ?, 'reject', ?, ?)",
          )
          .bind(kind, id, reviewerId, now),
        this.db
          .prepare(
            "UPDATE " + table +
              " SET status = 'rejected', reviewer_id = ?, reviewed_at = ? " +
              "WHERE id = ? AND status = 'pending'",
          )
          .bind(reviewerId, now, id),
      ]);
    } catch (error) {
      const reviewed = await this.db
        .prepare(
          "SELECT 1 AS reviewed FROM suggestion_review_guards " +
            "WHERE suggestion_kind = ? AND suggestion_id = ?",
        )
        .bind(kind, id)
        .first<{ reviewed: number }>();
      if (reviewed) {
        throw new WorkerHttpError(
          409,
          kind === "batch" ? "SUGGESTION_BATCH_REVIEWED" : "SUGGESTION_REVIEWED",
          kind === "batch" ? "批量校订已审核" : "纠错建议已审核",
        );
      }
      throw error;
    }
  }

  private async canEdit(documentId: string, principal: ForumUser): Promise<boolean> {
    if (principal.role === "moderator") return true;
    const access = await this.db
      .prepare(
        "SELECT 1 AS allowed FROM documents document " +
          "LEFT JOIN document_acl acl ON acl.document_id = document.id AND acl.user_id = ? " +
          "WHERE document.id = ? AND (document.created_by = ? OR acl.permission IN ('edit', 'admin'))",
      )
      .bind(principal.id, documentId, principal.id)
      .first<{ allowed: number }>();
    return Boolean(access);
  }

  async reviewSuggestion(
    suggestionId: string,
    decision: "approve" | "reject",
    baseRevision: number,
    reviewer: ForumUser,
  ): Promise<{ suggestion: Suggestion; document: Awaited<ReturnType<D1ReadRepository["document"]>> | null }> {
    const row = await this.db
      .prepare("SELECT * FROM suggestions WHERE id = ?")
      .bind(suggestionId)
      .first<SuggestionRow>();
    if (!row) throw new WorkerHttpError(404, "SUGGESTION_NOT_FOUND", "纠错建议不存在");
    if (row.status !== "pending") {
      throw new WorkerHttpError(409, "SUGGESTION_REVIEWED", "纠错建议已审核");
    }
    if (decision === "reject") {
      await this.reject("single", row.id, reviewer.id);
      const rejected = { ...row, status: "rejected" as const, reviewer_id: reviewer.id };
      return { suggestion: mapSuggestion(rejected), document: null };
    }

    const current = await this.reads.document(row.document_id);
    if (current.revision !== baseRevision) {
      throw new WorkerHttpError(409, "REVISION_CONFLICT", "正文已变化，请重新核对建议", {
        currentRevision: current.revision,
        baseRevision,
      });
    }
    const replaced = replaceFirstText(current.content, row.from_text, row.to_text);
    if (!replaced) {
      throw new WorkerHttpError(
        404,
        "SUGGESTION_SOURCE_NOT_FOUND",
        "当前正文已找不到待替换文字",
      );
    }
    const result = await this.writes.applySuggestionReview({
      documentId: row.document_id,
      baseRevision,
      suggestionId: row.id,
      kind: "single",
      content: replaced,
      reviewerId: reviewer.id,
      schemaVersion: current.schemaVersion,
      ...(row.chapter_id ? { chapterId: row.chapter_id } : {}),
    });
    if (!result.created) {
      throw new WorkerHttpError(409, "SUGGESTION_REVIEWED", "纠错建议已审核");
    }
    const approved = { ...row, status: "approved" as const, reviewer_id: reviewer.id };
    return { suggestion: mapSuggestion(approved), document: result.envelope };
  }

  async reviewBatch(
    batchId: string,
    decision: "approve" | "reject",
    baseRevision: number,
    reviewer: ForumUser,
  ): Promise<{ batch: SuggestionBatch; document: Awaited<ReturnType<D1ReadRepository["document"]>> | null }> {
    const row = await this.db
      .prepare("SELECT * FROM suggestion_batches WHERE id = ?")
      .bind(batchId)
      .first<SuggestionBatchRow>();
    if (!row) {
      throw new WorkerHttpError(404, "SUGGESTION_BATCH_NOT_FOUND", "批量校订不存在");
    }
    if (row.status !== "pending") {
      throw new WorkerHttpError(409, "SUGGESTION_BATCH_REVIEWED", "批量校订已审核");
    }
    if (decision === "reject") {
      await this.reject("batch", row.id, reviewer.id);
      const rejected = { ...row, status: "rejected" as const, reviewer_id: reviewer.id };
      return { batch: mapBatch(rejected), document: null };
    }

    const current = await this.reads.document(row.document_id);
    const merged = mergeSuggestionBatch(
      current.content,
      row.chapter_id,
      repairDocumentForRead(JSON.parse(row.before_content_json)),
      repairDocumentForRead(JSON.parse(row.after_content_json)),
    );
    if (!merged) {
      throw new WorkerHttpError(
        409,
        "BATCH_CHAPTER_CONFLICT",
        "当前章节已变化，无法安全应用整章批次",
        { currentRevision: current.revision, batchRevision: row.base_revision },
      );
    }
    const rebasedSteps = diffDocuments(
      current.content as unknown as JSONContent,
      merged as unknown as JSONContent,
    ) as unknown as Array<Record<string, unknown>>;
    const result = await this.writes.applySuggestionReview({
      documentId: row.document_id,
      baseRevision,
      suggestionId: row.id,
      kind: "batch",
      content: merged,
      reviewerId: reviewer.id,
      schemaVersion: current.schemaVersion,
      chapterId: row.chapter_id,
      steps: rebasedSteps,
    });
    if (!result.created) {
      throw new WorkerHttpError(409, "SUGGESTION_BATCH_REVIEWED", "批量校订已审核");
    }
    const approved = { ...row, status: "approved" as const, reviewer_id: reviewer.id };
    return { batch: mapBatch(approved), document: result.envelope };
  }
}
