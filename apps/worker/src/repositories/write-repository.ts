import {
  collectInlineCommentAnchorIds,
  type DocumentEnvelope,
  type RollbackDocumentRequest,
  type TiptapDocument,
  type UpdateDocumentRequest,
  type UpdateDocumentStepsRequest,
} from "@ricetext/contracts";
import {
  ApplyStepsError,
  applyStepsToDocument,
  createDocumentSchema,
  type JSONContent,
  type StepJson,
} from "@ricetext/document-core";
import { sanitizeDocumentForWrite } from "@ricetext/server-core";
import { WorkerHttpError } from "../http-error";
import { D1ReadRepository } from "./read-repository";

type DocumentPointerRow = {
  current_revision: number;
};

type MutationRow = {
  request_json: string;
  revision: number;
};

type RevisionContentRow = {
  schema_version: number;
  content_json: string;
};

type WriteOperation = "update" | "rollback" | "suggestion" | "steps";
type ReviewKind = "single" | "batch";

type WriteInput = {
  documentId: string;
  baseRevision: number;
  mutationId: string;
  requestJson: string;
  schemaVersion: number;
  content: TiptapDocument;
  authorId: string;
  operation: WriteOperation;
  targetRevision: number | null;
  stepsJson: string | null;
  chapterId?: string;
  review?: { kind: ReviewKind; id: string; reviewerId: string };
};

export type DocumentWriteResult = {
  envelope: DocumentEnvelope;
  created: boolean;
};

/** 文档写仓储；D1 batch 同时推进修订、幂等 mutation、章节版本和当前指针。 */
export class D1WriteRepository {
  private readonly reads: D1ReadRepository;

  constructor(private readonly db: D1Database) {
    this.reads = new D1ReadRepository(db);
  }

  async save(
    documentId: string,
    request: UpdateDocumentRequest,
    authorId: string,
  ): Promise<DocumentWriteResult> {
    return this.write({
      documentId,
      baseRevision: request.baseRevision,
      mutationId: request.clientMutationId,
      requestJson: JSON.stringify(request),
      schemaVersion: request.schemaVersion,
      content: sanitizeDocumentForWrite(request.content),
      authorId,
      operation: "update",
      targetRevision: null,
      stepsJson: null,
      ...(request.chapterId ? { chapterId: request.chapterId } : {}),
    });
  }

  async rollback(
    documentId: string,
    request: RollbackDocumentRequest,
    authorId: string,
  ): Promise<DocumentWriteResult> {
    const target = await this.db
      .prepare(
        "SELECT schema_version, content_json FROM document_revisions " +
          "WHERE document_id = ? AND revision = ?",
      )
      .bind(documentId, request.targetRevision)
      .first<RevisionContentRow>();
    if (!target) throw new WorkerHttpError(404, "REVISION_NOT_FOUND", "目标修订不存在");
    return this.write({
      documentId,
      baseRevision: request.baseRevision,
      mutationId: request.clientMutationId,
      requestJson: JSON.stringify(request),
      schemaVersion: target.schema_version,
      content: sanitizeDocumentForWrite(JSON.parse(target.content_json)),
      authorId,
      operation: "rollback",
      targetRevision: request.targetRevision,
      stepsJson: null,
    });
  }

  async applySteps(
    documentId: string,
    request: UpdateDocumentStepsRequest,
    authorId: string,
  ): Promise<DocumentWriteResult> {
    const current = await this.reads.document(documentId);
    let content: TiptapDocument;
    try {
      const updated = applyStepsToDocument(
        createDocumentSchema(),
        current.content as unknown as JSONContent,
        request.steps as unknown as StepJson[],
      );
      content = sanitizeDocumentForWrite(updated);
    } catch (error) {
      if (error instanceof ApplyStepsError) {
        throw new WorkerHttpError(422, "INVALID_STEPS", error.message);
      }
      throw error;
    }
    return this.write({
      documentId,
      baseRevision: request.baseRevision,
      mutationId: request.clientMutationId,
      requestJson: JSON.stringify(request),
      schemaVersion: request.schemaVersion,
      content,
      authorId,
      operation: "steps",
      targetRevision: null,
      stepsJson: JSON.stringify(request.steps),
      ...(request.chapterId ? { chapterId: request.chapterId } : {}),
    });
  }

  async applySuggestionReview(input: {
    documentId: string;
    baseRevision: number;
    suggestionId: string;
    kind: ReviewKind;
    content: TiptapDocument;
    reviewerId: string;
    schemaVersion: number;
    chapterId?: string;
    steps?: Array<Record<string, unknown>>;
  }): Promise<DocumentWriteResult> {
    const requestJson = JSON.stringify({
      baseRevision: input.baseRevision,
      suggestionId: input.suggestionId,
      kind: input.kind,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
      ...(input.steps ? { steps: input.steps } : {}),
    });
    return this.write({
      documentId: input.documentId,
      baseRevision: input.baseRevision,
      mutationId:
        (input.kind === "batch" ? "suggestion-batch-" : "suggestion-") + input.suggestionId,
      requestJson,
      schemaVersion: input.schemaVersion,
      content: sanitizeDocumentForWrite(input.content),
      authorId: input.reviewerId,
      operation: "suggestion",
      targetRevision: null,
      stepsJson: input.steps ? JSON.stringify(input.steps) : null,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
      review: { kind: input.kind, id: input.suggestionId, reviewerId: input.reviewerId },
    });
  }

  private async mutation(documentId: string, mutationId: string): Promise<MutationRow | null> {
    return this.db
      .prepare(
        "SELECT request_json, revision FROM document_mutations " +
          "WHERE document_id = ? AND client_mutation_id = ?",
      )
      .bind(documentId, mutationId)
      .first<MutationRow>();
  }

  private async idempotentResult(
    input: WriteInput,
    existing: MutationRow,
  ): Promise<DocumentWriteResult> {
    if (existing.request_json !== input.requestJson) {
      throw new WorkerHttpError(
        409,
        "MUTATION_ID_REUSED",
        "clientMutationId 已被另一请求使用",
      );
    }
    return {
      envelope: await this.reads.revision(input.documentId, existing.revision),
      created: false,
    };
  }

  private async write(input: WriteInput): Promise<DocumentWriteResult> {
    const existing = await this.mutation(input.documentId, input.mutationId);
    if (existing) return this.idempotentResult(input, existing);

    const document = await this.db
      .prepare("SELECT current_revision FROM documents WHERE id = ?")
      .bind(input.documentId)
      .first<DocumentPointerRow>();
    if (!document) throw new WorkerHttpError(404, "DOCUMENT_NOT_FOUND", "文档不存在");
    if (document.current_revision !== input.baseRevision) {
      throw new WorkerHttpError(409, "REVISION_CONFLICT", "文档已被其他修订更新", {
        currentRevision: document.current_revision,
        baseRevision: input.baseRevision,
      });
    }

    const revision = input.baseRevision + 1;
    const createdAt = new Date().toISOString();
    const contentJson = JSON.stringify(input.content);
    const anchors = [...collectInlineCommentAnchorIds(input.content)];
    const statements: D1PreparedStatement[] = [];
    if (input.review) {
      statements.push(
        this.db
          .prepare(
            "INSERT INTO suggestion_review_guards(" +
              "suggestion_kind, suggestion_id, decision, reviewer_id, created_at" +
              ") VALUES (?, ?, 'approve', ?, ?)",
          )
          .bind(
            input.review.kind,
            input.review.id,
            input.review.reviewerId,
            createdAt,
          ),
      );
    }
    statements.push(
      this.db
        .prepare(
          "INSERT INTO document_revisions(" +
            "document_id, revision, schema_version, content_json, steps_json, author_id, " +
            "operation, target_revision, created_at" +
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          input.documentId,
          revision,
          input.schemaVersion,
          contentJson,
          input.stepsJson,
          input.authorId,
          input.operation,
          input.targetRevision,
          createdAt,
        ),
      this.db
        .prepare(
          "INSERT INTO document_mutations(" +
            "document_id, client_mutation_id, request_json, revision" +
            ") VALUES (?, ?, ?, ?)",
        )
        .bind(input.documentId, input.mutationId, input.requestJson, revision),
      this.db
        .prepare(
          "UPDATE documents SET schema_version = ?, current_revision = ?, updated_at = ? " +
            "WHERE id = ? AND current_revision = ?",
        )
        .bind(
          input.schemaVersion,
          revision,
          createdAt,
          input.documentId,
          input.baseRevision,
        ),
      this.db
        .prepare("UPDATE comment_threads SET archived = 1 WHERE document_id = ?")
        .bind(input.documentId),
    );

    if (anchors.length > 0) {
      statements.push(
        this.db
          .prepare(
            "INSERT INTO comment_threads(document_id, anchor_id, archived, created_at) " +
              "SELECT ?, value, 0, ? FROM json_each(?) WHERE true " +
              "ON CONFLICT(document_id, anchor_id) DO UPDATE SET archived = 0",
          )
          .bind(input.documentId, createdAt, JSON.stringify(anchors)),
      );
    }
    if (input.chapterId) {
      statements.push(
        this.db
          .prepare(
            "UPDATE chapters SET revision = revision + 1, updated_at = ? " +
              "WHERE id = ? AND document_id = ?",
          )
          .bind(createdAt, input.chapterId, input.documentId),
      );
    }
    if (input.review) {
      const reviewSql =
        input.review.kind === "batch"
          ? "UPDATE suggestion_batches SET status = 'approved', reviewer_id = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'"
          : "UPDATE suggestions SET status = 'approved', reviewer_id = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'";
      statements.push(
        this.db
          .prepare(reviewSql)
          .bind(input.review.reviewerId, createdAt, input.review.id),
      );
    }

    try {
      await this.db.batch(statements);
      return {
        envelope: await this.reads.revision(input.documentId, revision),
        created: true,
      };
    } catch (error) {
      const concurrentMutation = await this.mutation(input.documentId, input.mutationId);
      if (concurrentMutation) return this.idempotentResult(input, concurrentMutation);
      if (input.review) {
        const reviewed = await this.db
          .prepare(
            "SELECT 1 AS reviewed FROM suggestion_review_guards " +
              "WHERE suggestion_kind = ? AND suggestion_id = ?",
          )
          .bind(input.review.kind, input.review.id)
          .first<{ reviewed: number }>();
        if (reviewed) {
          throw new WorkerHttpError(
            409,
            input.review.kind === "batch"
              ? "SUGGESTION_BATCH_REVIEWED"
              : "SUGGESTION_REVIEWED",
            input.review.kind === "batch" ? "批量校订已审核" : "纠错建议已审核",
          );
        }
      }
      const current = await this.db
        .prepare("SELECT current_revision FROM documents WHERE id = ?")
        .bind(input.documentId)
        .first<DocumentPointerRow>();
      if (current && current.current_revision !== input.baseRevision) {
        throw new WorkerHttpError(409, "REVISION_CONFLICT", "文档已被其他修订更新", {
          currentRevision: current.current_revision,
          baseRevision: input.baseRevision,
        });
      }
      throw error;
    }
  }
}
