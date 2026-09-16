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
  documentsEqual,
  replaceChapterRange,
  resolveChapterRange,
  splitDocumentByChapters,
  type JSONContent,
  type StepJson,
} from "@ricetext/document-core";
import {
  createChapterId,
  isUsableChapterId,
  sanitizeDocumentForWrite,
} from "@ricetext/server-core";
import { WorkerHttpError } from "../http-error";
import {
  appendChapterRevision,
  chapterRevisionGuard,
  latestChapterRevision,
  releaseChapterRevisionGuard,
} from "./chapter-ledger";
import { D1ReadRepository } from "./read-repository";

type DocumentPointerRow = {
  current_revision: number;
};

type MutationRow = {
  request_json: string;
  revision: number;
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
  /** 回滚目标：该章节自己的版本号，写入账本的 target_chapter_revision。 */
  targetChapterRevision?: number | null;
  review?: { kind: ReviewKind; id: string; reviewerId: string };
  /**
   * 章节级并发前置条件（校订审核）：只要求目标章节的内容版本未变，
   * 不再把整篇文档 revision 当作章节写入的并发基线。
   */
  chapterPrecondition?: { chapterId: string; expectedChapterRevision: number };
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
    const content = sanitizeDocumentForWrite(request.content);
    const exists = await this.db
      .prepare("SELECT 1 AS found FROM documents WHERE id = ?")
      .bind(documentId)
      .first<{ found: number }>();
    if (!exists && request.baseRevision === 0) {
      return this.create(documentId, request, content, authorId);
    }
    return this.write({
      documentId,
      baseRevision: request.baseRevision,
      mutationId: request.clientMutationId,
      requestJson: JSON.stringify(request),
      schemaVersion: request.schemaVersion,
      content,
      authorId,
      operation: "update",
      targetRevision: null,
      stepsJson: null,
      ...(request.chapterId ? { chapterId: request.chapterId } : {}),
    });
  }

  /** 空库首次保存：文档、owner ACL、首版和章节目录必须在一个 D1 batch 中落库。 */
  private async create(
    documentId: string,
    request: UpdateDocumentRequest,
    content: TiptapDocument,
    authorId: string,
  ): Promise<DocumentWriteResult> {
    const requestJson = JSON.stringify(request);
    const writeInput: WriteInput = {
      documentId,
      baseRevision: 0,
      mutationId: request.clientMutationId,
      requestJson,
      schemaVersion: request.schemaVersion,
      content,
      authorId,
      operation: "update",
      targetRevision: null,
      stepsJson: null,
    };
    const existingMutation = await this.mutation(documentId, request.clientMutationId);
    if (existingMutation) return this.idempotentResult(writeInput, existingMutation);

    const createdAt = new Date().toISOString();
    // 章节身份来自正文标题节点（由创建方铸造一次并持久化）；节点还没有身份时
    // 服务端现铸一个作为兜底，位置只用于记录 sort_order。
    const chapters = splitDocumentByChapters(content as unknown as JSONContent).chapters;
    const chapterRows =
      chapters.length > 0
        ? chapters.map((chapter) => {
            const sourceId = chapter.blocks[0]?.attrs?.chapterId;
            return {
              id: isUsableChapterId(sourceId) ? sourceId : createChapterId(),
              title: chapter.title,
            };
          })
        : [{ id: createChapterId(), title: "正文" }];
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          "INSERT INTO documents(id, title, schema_version, current_revision, created_by, created_at, updated_at) " +
            "VALUES (?, ?, ?, 1, ?, ?, ?)",
        )
        .bind(
          documentId,
          request.title ?? "未命名文章",
          request.schemaVersion,
          authorId,
          createdAt,
          createdAt,
        ),
      this.db
        .prepare(
          "INSERT INTO document_revisions(document_id, revision, schema_version, content_json, steps_json, author_id, operation, target_revision, created_at) " +
            "VALUES (?, 1, ?, ?, NULL, ?, 'update', NULL, ?)",
        )
        .bind(documentId, request.schemaVersion, JSON.stringify(content), authorId, createdAt),
      this.db
        .prepare(
          "INSERT INTO document_mutations(document_id, client_mutation_id, request_json, revision, created_at) " +
            "VALUES (?, ?, ?, 1, ?)",
        )
        .bind(documentId, request.clientMutationId, requestJson, createdAt),
      this.db
        .prepare(
          "INSERT INTO document_acl(document_id, user_id, permission, created_at) VALUES (?, ?, 'admin', ?)",
        )
        .bind(documentId, authorId, createdAt),
      ...chapterRows.map((chapter, order) =>
        this.db
          .prepare(
            "INSERT INTO chapters(id, title, sort_order, document_id, revision, updated_at, hidden) " +
              "VALUES (?, ?, ?, ?, 1, ?, 0)",
          )
          .bind(chapter.id, chapter.title, order, documentId, createdAt),
      ),
      // 首版正文里的每个章节都要在账本里有自己的第 1 个版本，
      // 否则章节历史会缺少创建时的内容快照。
      ...chapterRows.map((chapter) =>
        appendChapterRevision(this.db, {
          documentId,
          chapterId: chapter.id,
          documentRevision: 1,
          operation: "update",
          schemaVersion: request.schemaVersion,
          authorId,
          createdAt,
        }),
      ),
    ];
    try {
      await this.db.batch(statements);
      return {
        envelope: await this.reads.revision(documentId, 1),
        created: true,
      };
    } catch (error) {
      const concurrentMutation = await this.mutation(documentId, request.clientMutationId);
      if (concurrentMutation) return this.idempotentResult(writeInput, concurrentMutation);
      const current = await this.db
        .prepare("SELECT current_revision FROM documents WHERE id = ?")
        .bind(documentId)
        .first<DocumentPointerRow>();
      if (current) {
        throw new WorkerHttpError(409, "REVISION_CONFLICT", "文档已由另一请求创建", {
          currentRevision: current.current_revision,
          baseRevision: 0,
        });
      }
      throw error;
    }
  }

  async rollback(
    documentId: string,
    request: RollbackDocumentRequest,
    authorId: string,
  ): Promise<DocumentWriteResult> {
    const targetDocumentRevision = await this.reads.documentRevisionForChapter(
      documentId,
      request.chapterId,
      request.targetRevision,
    );
    const [target, current] = await Promise.all([
      this.reads.revision(documentId, targetDocumentRevision),
      this.reads.document(documentId),
    ]);
    // 章节定位只走 resolveChapterRange：显式 chapterId 优先，只有整篇正文都还
    // 没有显式身份的旧文档才按服务端目录顺序回退，无法确认时直接 404。
    const chapterOrder = await this.chapterOrder(documentId, request.chapterId);
    const targetRange = resolveChapterRange(
      target.content as unknown as JSONContent,
      request.chapterId,
      chapterOrder,
    );
    const currentRange = resolveChapterRange(
      current.content as unknown as JSONContent,
      request.chapterId,
      chapterOrder,
    );
    if (!targetRange || !currentRange) {
      throw new WorkerHttpError(404, "CHAPTER_NOT_FOUND", "目标章节在历史或当前正文中不存在");
    }
    const content = replaceChapterRange(
      current.content as unknown as JSONContent,
      currentRange,
      {
        type: "doc",
        content: (target.content as unknown as JSONContent).content!.slice(
          targetRange.start,
          targetRange.end,
        ),
      },
      request.chapterId,
    );
    if (!content) {
      throw new WorkerHttpError(404, "CHAPTER_NOT_FOUND", "目标章节在历史或当前正文中不存在");
    }
    return this.write({
      documentId,
      baseRevision: request.baseRevision,
      mutationId: request.clientMutationId,
      requestJson: JSON.stringify(request),
      schemaVersion: current.schemaVersion,
      content: sanitizeDocumentForWrite(content),
      authorId,
      operation: "rollback",
      targetRevision: targetDocumentRevision,
      targetChapterRevision: request.targetRevision,
      stepsJson: null,
      chapterId: request.chapterId,
    });
  }

  async applySteps(
    documentId: string,
    request: UpdateDocumentStepsRequest,
    authorId: string,
  ): Promise<DocumentWriteResult> {
    const requestJson = JSON.stringify(request);
    const existing = await this.mutation(documentId, request.clientMutationId);
    if (existing) return this.idempotentResult({ documentId, requestJson }, existing);

    const current = await this.reads.document(documentId);
    if (current.revision !== request.baseRevision) {
      // 快照读取期间可能已有相同请求提交，冲突前再次回收其成功结果。
      const concurrentMutation = await this.mutation(documentId, request.clientMutationId);
      if (concurrentMutation) {
        return this.idempotentResult({ documentId, requestJson }, concurrentMutation);
      }
      throw new WorkerHttpError(409, "REVISION_CONFLICT", "文档已被其他修订更新", {
        currentRevision: current.revision,
        baseRevision: request.baseRevision,
      });
    }
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
    // 空转增量（steps 只是把正文重放回当前内容）直接返回现有修订，不写新版本：
    // 重复点击保存不应留下内容完全相同的修订，否则历史对比全是噪声。
    if (
      documentsEqual(current.content as unknown as JSONContent, content as unknown as JSONContent)
    )
      return { envelope: current, created: false };
    return this.write({
      documentId,
      baseRevision: request.baseRevision,
      mutationId: request.clientMutationId,
      requestJson,
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
    chapterPrecondition?: { chapterId: string; expectedChapterRevision: number };
  }): Promise<DocumentWriteResult> {
    const requestJson = JSON.stringify({
      baseRevision: input.baseRevision,
      suggestionId: input.suggestionId,
      kind: input.kind,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
      ...(input.steps ? { steps: input.steps } : {}),
    });
    const content = sanitizeDocumentForWrite(input.content);
    const current = await this.reads.document(input.documentId);
    // 建议内容与当前正文一致时不落库，避免审核空转建议产生噪声修订。
    // 这里只比较正文：章节级审核的并发基线是目标章节内容版本，不再是整篇 revision。
    if (documentsEqual(current.content as unknown as JSONContent, content as unknown as JSONContent))
      return { envelope: current, created: false };
    return this.write({
      documentId: input.documentId,
      baseRevision: input.baseRevision,
      mutationId: input.suggestionId,
      requestJson,
      schemaVersion: input.schemaVersion,
      content,
      authorId: input.reviewerId,
      operation: "suggestion",
      targetRevision: null,
      stepsJson: input.steps ? JSON.stringify(input.steps) : null,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
      ...(input.chapterPrecondition ? { chapterPrecondition: input.chapterPrecondition } : {}),
      review: {
        kind: input.kind,
        id: input.suggestionId,
        reviewerId: input.reviewerId,
      },
    });
  }

  /** 服务端目录顺序：仅用于没有显式章节身份的旧文档定位。 */
  private async chapterOrder(documentId: string, chapterId: string): Promise<number | null> {
    const row = await this.db
      .prepare("SELECT sort_order FROM chapters WHERE id = ? AND document_id = ?")
      .bind(chapterId, documentId)
      .first<{ sort_order: number }>();
    return row?.sort_order ?? null;
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
    input: Pick<WriteInput, "documentId" | "requestJson">,
    existing: MutationRow,
  ): Promise<DocumentWriteResult> {
    if (existing.request_json !== input.requestJson) {
      throw new WorkerHttpError(409, "MUTATION_ID_REUSED", "clientMutationId 已被另一请求使用");
    }
    return {
      envelope: await this.reads.revision(input.documentId, existing.revision),
      created: false,
    };
  }

  private async write(input: WriteInput): Promise<DocumentWriteResult> {
    const existing = await this.mutation(input.documentId, input.mutationId);
    if (existing) return this.idempotentResult(input, existing);

    // 章节级前置条件允许在「其他章节同时写入」造成的取号竞争中重取修订号：
    // 每次重试都重新读取当前指针并重新校验章节守卫，只有章节本身变化才是真冲突。
    const attempts = input.chapterPrecondition ? 3 : 1;
    for (let attempt = 1; ; attempt += 1) {
      const pointer = await this.requirePointer(input.documentId);
      if (!input.chapterPrecondition && pointer.current_revision !== input.baseRevision) {
        throw new WorkerHttpError(409, "REVISION_CONFLICT", "文档已被其他修订更新", {
          currentRevision: pointer.current_revision,
          baseRevision: input.baseRevision,
        });
      }
      try {
        return await this.commitWrite(input, pointer.current_revision);
      } catch (error) {
        const concurrentMutation = await this.mutation(input.documentId, input.mutationId);
        if (concurrentMutation) return this.idempotentResult(input, concurrentMutation);
        const failure = await this.mapWriteFailure(input, pointer.current_revision, error);
        if (failure.retry && attempt < attempts) continue;
        throw failure.error;
      }
    }
  }

  private async requirePointer(documentId: string): Promise<DocumentPointerRow> {
    const document = await this.db
      .prepare("SELECT current_revision FROM documents WHERE id = ?")
      .bind(documentId)
      .first<DocumentPointerRow>();
    if (!document) throw new WorkerHttpError(404, "DOCUMENT_NOT_FOUND", "文档不存在");
    return document;
  }

  /**
   * 把 batch 失败映射成对外错误。
   *
   * 只有「提交期间其他写入推进了整篇指针」对章节级写入是可重试的取号竞争；
   * 章节守卫、审核守卫与真正的基线冲突必须原样抛出，绝不静默成功。
   */
  private async mapWriteFailure(
    input: WriteInput,
    attemptedRevision: number,
    error: unknown,
  ): Promise<{ retry: boolean; error: unknown }> {
    const detail = error instanceof Error ? error.message : String(error);
    const precondition = input.chapterPrecondition;
    if (precondition && detail.includes("CHAPTER_REVISION_CONFLICT")) {
      const current = await latestChapterRevision(this.db, input.documentId, precondition.chapterId);
      return {
        retry: false,
        error: new WorkerHttpError(
          409,
          "CHAPTER_REVISION_CONFLICT",
          "该章节已被其他修改更新，请重新核对校订内容",
          {
            chapterId: precondition.chapterId,
            currentChapterRevision: current,
            expectedChapterRevision: precondition.expectedChapterRevision,
          },
        ),
      };
    }
    if (input.review) {
      const reviewed = await this.db
        .prepare(
          "SELECT 1 AS reviewed FROM suggestion_review_guards " +
            "WHERE suggestion_kind = ? AND suggestion_id = ?",
        )
        .bind(input.review.kind, input.review.id)
        .first<{ reviewed: number }>();
      if (reviewed) {
        return {
          retry: false,
          error: new WorkerHttpError(
            409,
            input.review.kind === "batch" ? "SUGGESTION_BATCH_REVIEWED" : "SUGGESTION_REVIEWED",
            input.review.kind === "batch" ? "批量校订已审核" : "纠错建议已审核",
          ),
        };
      }
    }
    const current = await this.db
      .prepare("SELECT current_revision FROM documents WHERE id = ?")
      .bind(input.documentId)
      .first<DocumentPointerRow>();
    if (current && current.current_revision !== attemptedRevision) {
      return {
        retry: Boolean(precondition),
        error: new WorkerHttpError(409, "REVISION_CONFLICT", "文档已被其他修订更新", {
          currentRevision: current.current_revision,
          baseRevision: input.baseRevision,
        }),
      };
    }
    return { retry: false, error };
  }

  private async commitWrite(input: WriteInput, baseRevision: number): Promise<DocumentWriteResult> {
    const revision = baseRevision + 1;
    const createdAt = new Date().toISOString();
    const contentJson = JSON.stringify(input.content);
    const anchors = [...collectInlineCommentAnchorIds(input.content)];
    const statements: D1PreparedStatement[] = [];
    if (input.chapterPrecondition) {
      statements.push(
        chapterRevisionGuard(
          this.db,
          input.documentId,
          input.chapterPrecondition.chapterId,
          input.chapterPrecondition.expectedChapterRevision,
        ),
      );
    }
    if (input.review) {
      statements.push(
        this.db
          .prepare(
            "INSERT INTO suggestion_review_guards(" +
              "suggestion_kind, suggestion_id, decision, reviewer_id, created_at" +
              ") VALUES (?, ?, 'approve', ?, ?)",
          )
          .bind(input.review.kind, input.review.id, input.review.reviewerId, createdAt),
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
            "document_id, client_mutation_id, request_json, revision, created_at" +
            ") VALUES (?, ?, ?, ?, ?)",
        )
        .bind(input.documentId, input.mutationId, input.requestJson, revision, createdAt),
      // 章节版本账本：归属由服务端写入决定，不再从请求 JSON 反推。
      ...(input.chapterId
        ? [
            appendChapterRevision(this.db, {
              documentId: input.documentId,
              chapterId: input.chapterId,
              documentRevision: revision,
              operation: input.operation,
              schemaVersion: input.schemaVersion,
              authorId: input.authorId,
              targetChapterRevision:
                input.operation === "rollback" ? (input.targetChapterRevision ?? null) : null,
              stepsJson: input.stepsJson,
              createdAt,
            }),
          ]
        : []),
      this.db
        .prepare(
          "UPDATE documents SET schema_version = ?, current_revision = ?, updated_at = ? " +
            "WHERE id = ? AND current_revision = ?",
        )
        .bind(input.schemaVersion, revision, createdAt, input.documentId, baseRevision),
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
        this.db.prepare(reviewSql).bind(input.review.reviewerId, createdAt, input.review.id),
      );
    }

    if (input.chapterPrecondition) {
      statements.push(
        releaseChapterRevisionGuard(this.db, input.documentId, input.chapterPrecondition.chapterId),
      );
    }
    await this.db.batch(statements);
    return {
      envelope: await this.reads.revision(input.documentId, revision),
      created: true,
    };
  }
}
