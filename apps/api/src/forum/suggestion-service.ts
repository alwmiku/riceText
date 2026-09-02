import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DocumentEnvelope, TiptapDocument } from "@ricetext/contracts";
import { diffDocuments, type JSONContent } from "@ricetext/document-core";
import {
  DomainError,
  mergeSuggestionBatch,
  repairDocumentForRead,
  replaceFirstText,
  validateSuggestionBatch,
} from "@ricetext/server-core";
import type { RequestIdentity } from "../auth.js";
import type { DocumentService } from "../document-service.js";
import { HttpError } from "../errors.js";

interface SuggestionRow {
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
}
interface SuggestionBatchRow {
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
}
export function mapSuggestion(row: SuggestionRow) {
  return {
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
  };
}

export function mapSuggestionBatch(row: SuggestionBatchRow) {
  return {
    id: row.id,
    documentId: row.document_id,
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    baseRevision: row.base_revision,
    beforeContent: repairDocumentForRead(JSON.parse(row.before_content_json)),
    afterContent: repairDocumentForRead(JSON.parse(row.after_content_json)),
    steps: JSON.parse(row.steps_json) as Array<Record<string, unknown>>,
    reason: row.reason,
    status: row.status,
    authorId: row.author_id,
    reviewerId: row.reviewer_id,
    createdAt: row.created_at,
  };
}

export class SuggestionService {
  readonly #db: DatabaseSync;
  readonly #documents: DocumentService;

  constructor(db: DatabaseSync, documents: DocumentService) {
    this.#db = db;
    this.#documents = documents;
  }

  /** 按身份过滤纠错建议。 */
  suggestions(documentId: string, identity: RequestIdentity) {
    this.#documents.get(documentId);
    const rows = (!this.#canEdit(documentId, identity)
      ? this.#db
          .prepare(
            "SELECT * FROM suggestions WHERE document_id = ? AND author_id = ? ORDER BY created_at DESC",
          )
          .all(documentId, identity.id)
      : this.#db
          .prepare(
            "SELECT * FROM suggestions WHERE document_id = ? ORDER BY created_at DESC",
          )
          .all(documentId)) as unknown as SuggestionRow[];
    return rows.map(mapSuggestion);
  }

  /** 按身份读取整章批量校订。 */
  suggestionBatches(documentId: string, identity: RequestIdentity) {
    this.#documents.get(documentId);
    const rows = (!this.#canEdit(documentId, identity)
      ? this.#db
          .prepare(
            "SELECT * FROM suggestion_batches WHERE document_id = ? AND author_id = ? ORDER BY created_at DESC",
          )
          .all(documentId, identity.id)
      : this.#db
          .prepare(
            "SELECT * FROM suggestion_batches WHERE document_id = ? ORDER BY created_at DESC",
          )
          .all(documentId)) as unknown as SuggestionBatchRow[];
    return rows.map(mapSuggestionBatch);
  }

  /** 创建一个包含多个 steps 的待审核整章校订批次。 */
  createSuggestionBatch(
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
    identity: RequestIdentity,
  ) {
    const current = this.#documents.get(documentId);
    const chapter = this.#db
      .prepare("SELECT 1 FROM chapters WHERE id = ? AND document_id = ?")
      .get(input.chapterId, documentId);
    if (!chapter) throw new HttpError(404, "CHAPTER_NOT_FOUND", "章节不存在或不属于当前文档");
    if (current.revision !== input.baseRevision)
      throw new HttpError(409, "REVISION_CONFLICT", "正文已变化，请重新编辑后提交", {
        currentRevision: current.revision,
        baseRevision: input.baseRevision,
      });
    try {
      validateSuggestionBatch(current.content, input);
    } catch (error) {
      if (error instanceof DomainError) {
        throw new HttpError(error.status, error.code, error.message, error.details);
      }
      throw error;
    }
    const row: SuggestionBatchRow = {
      id: randomUUID(),
      document_id: documentId,
      chapter_id: input.chapterId,
      chapter_title: input.chapterTitle,
      base_revision: input.baseRevision,
      before_content_json: JSON.stringify(input.beforeContent),
      after_content_json: JSON.stringify(input.afterContent),
      steps_json: JSON.stringify(input.steps),
      reason: input.reason,
      status: "pending",
      author_id: identity.id,
      reviewer_id: null,
      created_at: new Date().toISOString(),
    };
    this.#db
      .prepare(
        "INSERT INTO suggestion_batches(id, document_id, chapter_id, chapter_title, base_revision, before_content_json, after_content_json, steps_json, reason, status, author_id, reviewer_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?)",
      )
      .run(
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
      );
    return mapSuggestionBatch(row);
  }

  /** 原子应用或拒绝整章批量校订。 */
  reviewSuggestionBatch(
    batchId: string,
    decision: "approve" | "reject",
    baseRevision: number,
    identity: RequestIdentity,
  ): { batch: ReturnType<typeof mapSuggestionBatch>; document: DocumentEnvelope | null } {
    if (identity.role === "reader")
      throw new HttpError(403, "FORBIDDEN", "只有作者或版主可以审核批量校订");
    const row = this.#db
      .prepare("SELECT * FROM suggestion_batches WHERE id = ?")
      .get(batchId) as unknown as SuggestionBatchRow | undefined;
    if (!row)
      throw new HttpError(404, "SUGGESTION_BATCH_NOT_FOUND", "批量校订不存在");
    this.#requireEditor(row.document_id, identity);
    if (row.status !== "pending")
      throw new HttpError(409, "SUGGESTION_BATCH_REVIEWED", "批量校订已审核");
    let document: DocumentEnvelope | null = null;
    if (decision === "approve") {
      const current = this.#documents.get(row.document_id);
      const merged = mergeSuggestionBatch(
        current.content,
        row.chapter_id,
        JSON.parse(row.before_content_json) as TiptapDocument,
        JSON.parse(row.after_content_json) as TiptapDocument,
      );
      if (!merged)
        throw new HttpError(
          409,
          "BATCH_CHAPTER_CONFLICT",
          "当前章节已变化，无法安全应用整章批次",
          { currentRevision: current.revision, batchRevision: row.base_revision },
        );
      const rebasedSteps = diffDocuments(
        current.content as unknown as JSONContent,
        merged as unknown as JSONContent,
      ) as unknown as Array<Record<string, unknown>>;
      document = this.#documents.applySuggestionBatch(
        row.document_id,
        baseRevision,
        row.id,
        rebasedSteps,
        row.chapter_id,
        identity.id,
        (createdAt) => {
          const review = this.#db
            .prepare(
              "UPDATE suggestion_batches SET status = 'approved', reviewer_id = ?, reviewed_at = ? " +
                "WHERE id = ? AND status = 'pending'",
            )
            .run(identity.id, createdAt, row.id);
          if (review.changes !== 1) {
            throw new HttpError(409, "SUGGESTION_BATCH_REVIEWED", "批量校订已审核");
          }
        },
      );
    } else {
      const review = this.#db
        .prepare(
          "UPDATE suggestion_batches SET status = 'rejected', reviewer_id = ?, reviewed_at = ? " +
            "WHERE id = ? AND status = 'pending'",
        )
        .run(identity.id, new Date().toISOString(), row.id);
      if (review.changes !== 1) {
        throw new HttpError(409, "SUGGESTION_BATCH_REVIEWED", "批量校订已审核");
      }
    }
    row.status = decision === "approve" ? "approved" : "rejected";
    row.reviewer_id = identity.id;
    return { batch: mapSuggestionBatch(row), document };
  }

  /** 新建 pending 建议；旧客户端不传定位字段时按空章节/0 行存储。 */
  createSuggestion(
    documentId: string,
    fromText: string,
    toText: string,
    reason: string,
    identity: RequestIdentity,
    location: {
      chapterId: string;
      chapterTitle: string;
      lineNo: number;
      lineText: string;
    },
  ) {
    this.#documents.get(documentId);
    if (location.chapterId) {
      const chapter = this.#db
        .prepare("SELECT 1 FROM chapters WHERE id = ? AND document_id = ?")
        .get(location.chapterId, documentId);
      if (!chapter) {
        throw new HttpError(404, "CHAPTER_NOT_FOUND", "章节不存在或不属于当前文档");
      }
    }
    const row: SuggestionRow = {
      id: randomUUID(),
      document_id: documentId,
      chapter_id: location.chapterId || null,
      chapter_title: location.chapterTitle,
      line_no: location.lineNo,
      line_text: location.lineText,
      from_text: fromText,
      to_text: toText,
      reason,
      status: "pending",
      author_id: identity.id,
      reviewer_id: null,
      created_at: new Date().toISOString(),
    };
    this.#db
      .prepare(
        "INSERT INTO suggestions(id, document_id, chapter_id, chapter_title, line_no, line_text, from_text, to_text, reason, status, author_id, reviewer_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?)",
      )
      .run(
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
      );
    return mapSuggestion(row);
  }

  /** 审核建议；通过时合并到正文并创建真实修订。 */
  reviewSuggestion(
    suggestionId: string,
    decision: "approve" | "reject",
    baseRevision: number,
    identity: RequestIdentity,
  ): {
    suggestion: ReturnType<typeof mapSuggestion>;
    document: DocumentEnvelope | null;
  } {
    if (identity.role === "reader")
      throw new HttpError(403, "FORBIDDEN", "只有作者或版主可以审核建议");
    const row = this.#db
      .prepare("SELECT * FROM suggestions WHERE id = ?")
      .get(suggestionId) as unknown as SuggestionRow | undefined;
    if (!row)
      throw new HttpError(404, "SUGGESTION_NOT_FOUND", "纠错建议不存在");
    this.#requireEditor(row.document_id, identity);
    if (row.status !== "pending")
      throw new HttpError(409, "SUGGESTION_REVIEWED", "纠错建议已审核");
    let document: DocumentEnvelope | null = null;
    if (decision === "approve") {
      const current = this.#documents.get(row.document_id);
      if (current.revision !== baseRevision)
        throw new HttpError(
          409,
          "REVISION_CONFLICT",
          "正文已变化，请重新核对建议",
          { currentRevision: current.revision, baseRevision },
        );
      const replaced = replaceFirstText(
        current.content,
        row.from_text,
        row.to_text,
      );
      if (!replaced)
        throw new HttpError(
          404,
          "SUGGESTION_SOURCE_NOT_FOUND",
          "当前正文已找不到待替换文字",
        );
      document = this.#documents.applySuggestion(
        row.document_id,
        baseRevision,
        suggestionId,
        replaced,
        identity.id,
        {
          ...(row.chapter_id ? { chapterId: row.chapter_id } : {}),
          beforeCommit: (createdAt) => {
            const review = this.#db
              .prepare(
                "UPDATE suggestions SET status = 'approved', reviewer_id = ?, reviewed_at = ? " +
                  "WHERE id = ? AND status = 'pending'",
              )
              .run(identity.id, createdAt, row.id);
            if (review.changes !== 1) {
              throw new HttpError(409, "SUGGESTION_REVIEWED", "纠错建议已审核");
            }
          },
        },
      );
    } else {
      const review = this.#db
        .prepare(
          "UPDATE suggestions SET status = 'rejected', reviewer_id = ?, reviewed_at = ? " +
            "WHERE id = ? AND status = 'pending'",
        )
        .run(identity.id, new Date().toISOString(), row.id);
      if (review.changes !== 1) {
        throw new HttpError(409, "SUGGESTION_REVIEWED", "纠错建议已审核");
      }
    }
    row.status = decision === "approve" ? "approved" : "rejected";
    row.reviewer_id = identity.id;
    return { suggestion: mapSuggestion(row), document };
  }

  #canEdit(documentId: string, identity: RequestIdentity): boolean {
    if (identity.role === "moderator") return true;
    return Boolean(
      this.#db
        .prepare(
          "SELECT 1 FROM documents document " +
            "LEFT JOIN document_acl acl ON acl.document_id = document.id AND acl.user_id = ? " +
            "WHERE document.id = ? AND (document.created_by = ? OR acl.permission IN ('edit', 'admin'))",
        )
        .get(identity.id, documentId, identity.id),
    );
  }

  #requireEditor(documentId: string, identity: RequestIdentity): void {
    if (!this.#canEdit(documentId, identity)) {
      throw new HttpError(403, "FORBIDDEN", "当前身份无权审核此文档");
    }
  }
}
