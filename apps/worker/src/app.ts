import {
  CommentSortSchema,
  CreateCommentReplyRequestSchema,
  PasswordLoginRequestSchema,
  CreateDiceRollRequestSchema,
  CreateDocumentChapterRequestSchema,
  CreateSuggestionBatchRequestSchema,
  CursorQuerySchema,
  ResolveMentionRequestSchema,
  ResolveReplyGateRequestSchema,
  CreateSuggestionRequestSchema,
  getContractRoute,
  ReviewSuggestionBatchRequestSchema,
  ReviewSuggestionRequestSchema,
  RevisionQuerySchema,
  SaveNovelChapterRequestSchema,
  SubmitPollVoteRequestSchema,
  SyncNovelChaptersRequestSchema,
  UpdateDocumentChapterRequestSchema,
  RollbackDocumentRequestSchema,
  SaveNovelChaptersBatchRequestSchema,
  StageNovelChapterReorderRequestSchema,
  UpdateDocumentRequestSchema,
  UpdateDocumentStepsRequestSchema,
  VoteCommentRequestSchema,
  type DocumentEnvelope,
  type SaveNovelChaptersBatchRequest,
  type StageNovelChapterReorderRequest,
} from "@ricetext/contracts";
import { DomainError, projectDocumentForReader } from "@ricetext/server-core";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  availableUsers,
  canEditDocument,
  optionalPrincipal,
  requireDocumentEditor,
  requirePrincipal,
  sessionUser,
} from "./auth";
import type { WorkerEnv, WorkerVariables } from "./env";
import { WorkerHttpError } from "./http-error";
import { beginOidcLogin, finishOidcLogin, logout } from "./oidc";
import { passwordLogin } from "./password-auth";
import { D1AssetRepository } from "./repositories/asset-repository";
import { D1AttachmentRepository } from "./repositories/attachment-repository";
import { D1ChapterRepository } from "./repositories/chapter-repository";
import { D1CommentRepository } from "./repositories/comment-repository";
import { D1DiceRepository } from "./repositories/dice-repository";
import { D1ForumRepository } from "./repositories/forum-repository";
import { D1PollRepository } from "./repositories/poll-repository";
import { D1ReadRepository } from "./repositories/read-repository";
import { D1SuggestionRepository } from "./repositories/suggestion-repository";
import { D1WriteRepository } from "./repositories/write-repository";

type AppBindings = { Bindings: WorkerEnv; Variables: WorkerVariables };
type JsonObject = Record<string, unknown>;

/** 批量请求体上限（与契约描述一致，约 5 MiB）；客户端按 4 MiB 切批。 */
const MAX_BATCH_BODY_BYTES = 5 * 1024 * 1024;
const batchEncoder = new TextEncoder();

/** 读取批量请求体并同时校验 Content-Length 与实际序列化字节数。 */
async function limitedBatchBody<T>(
  _operationId: string,
  context: {
    req: {
      header: (name: string) => string | undefined;
      text: () => Promise<string>;
    };
  },
  schema: { parse(value: unknown): T },
): Promise<T> {
  const contentLength = context.req.header("content-length");
  if (
    contentLength !== undefined &&
    Number(contentLength) > MAX_BATCH_BODY_BYTES
  ) {
    throw new WorkerHttpError(
      413,
      "CHAPTER_BATCH_TOO_LARGE",
      "批量请求体超过 5 MiB 上限，请缩小批次或拆分章节正文",
    );
  }
  const text = await context.req.text();
  if (batchEncoder.encode(text).byteLength > MAX_BATCH_BODY_BYTES) {
    throw new WorkerHttpError(
      413,
      "CHAPTER_BATCH_TOO_LARGE",
      "批量请求体超过 5 MiB 上限，请缩小批次或拆分章节正文",
    );
  }
  try {
    return schema.parse(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new WorkerHttpError(422, "VALIDATION_ERROR", "请求体不是有效的 JSON");
    }
    throw error;
  }
}

function params(operationId: string, value: Record<string, string>): Record<string, string> {
  const schema = getContractRoute(operationId).params;
  return (schema ? schema.parse(value) : value) as Record<string, string>;
}

function parseQuery(operationId: string, value: Record<string, string>): Record<string, unknown> {
  const schema = getContractRoute(operationId).query;
  return (schema ? schema.parse(value) : value) as Record<string, unknown>;
}

function response(operationId: string, status: number, value: unknown): JsonObject {
  const schema = getContractRoute(operationId).responses[status]?.schema;
  if (!schema) throw new Error("Missing response schema for " + operationId + " " + String(status));
  return schema.parse(value) as JsonObject;
}

async function body(operationId: string, context: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  const schema = getContractRoute(operationId).body;
  if (!schema) throw new Error("Missing request schema for " + operationId);
  try {
    return schema.parse(await context.req.json());
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new WorkerHttpError(422, "VALIDATION_ERROR", "请求体不是有效的 JSON");
    }
    throw error;
  }
}

async function visibleEnvelope(
  db: D1Database,
  envelope: DocumentEnvelope,
  fullAccess: boolean,
): Promise<DocumentEnvelope> {
  if (fullAccess) return envelope;
  const rows = await db
    .prepare("SELECT sort_order FROM chapters WHERE document_id = ? AND hidden = 1")
    .bind(envelope.id)
    .all<{ sort_order: number }>();
  return {
    ...envelope,
    content: projectDocumentForReader(
      envelope.content,
      new Set(rows.results.map((row) => row.sort_order)),
    ),
  };
}

function errorPayload(error: WorkerHttpError): JsonObject {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  };
}

/** 组装 Worker 路由与全局安全中间件；业务规则下沉到共享核心和 D1 仓储。 */
export function createWorkerApp(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.use("*", async (context, next) => {
    const requestId = context.req.header("cf-ray") ?? crypto.randomUUID();
    context.set("requestId", requestId);
    await next();
    context.header("x-request-id", requestId);
    context.header("x-content-type-options", "nosniff");
    context.header("referrer-policy", "strict-origin-when-cross-origin");
    context.header("cache-control", context.res.headers.get("cache-control") ?? "no-store");
  });

  app.use("/api/*", async (context, next) => {
    const origin = context.req.header("origin");
    const allowed = new Set(
      context.env.ALLOWED_ORIGINS.split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
    if (context.req.method === "OPTIONS") {
      if (!origin || !allowed.has(origin)) {
        throw new WorkerHttpError(403, "ORIGIN_FORBIDDEN", "请求来源不在允许列表中");
      }
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-credentials": "true",
          "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "access-control-allow-headers":
          context.env.ALLOW_DEMO_AUTH === "true"
            ? "content-type, x-user-id"
            : "content-type",
          vary: "Origin",
        },
      });
    }
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(context.req.method);
    if (
      unsafe &&
      context.env.ENVIRONMENT !== "development" &&
      (!origin || !allowed.has(origin))
    ) {
      throw new WorkerHttpError(403, "ORIGIN_FORBIDDEN", "请求来源不在允许列表中");
    }
    await next();
    if (origin && allowed.has(origin)) {
      context.header("access-control-allow-origin", origin);
      context.header("access-control-allow-credentials", "true");
      context.header("vary", "Origin");
    }
  });

  app.post("/api/auth/password/login", async (context) => {
    const request = PasswordLoginRequestSchema.parse(await context.req.json());
    const sourceAddress =
      context.req.header("cf-connecting-ip") ??
      (context.env.ENVIRONMENT === "development"
        ? context.req.header("x-forwarded-for") ?? "local"
        : "unknown");
    return passwordLogin(request, context.env, sourceAddress);
  });
  app.get("/api/auth/login", (context) => beginOidcLogin(context.req.raw, context.env));
  app.get("/api/auth/callback", (context) => finishOidcLogin(context.req.raw, context.env));
  app.post("/api/auth/logout", (context) => logout(context.req.raw, context.env));

  app.get("/api/health", (context) =>
    context.json({ ok: true, service: "ricetext-worker", environment: context.env.ENVIRONMENT }),
  );
  app.get("/health", (context) =>
    context.json({ ok: true, service: "ricetext-worker", environment: context.env.ENVIRONMENT }),
  );

  app.post("/api/assets", async (context) => {
    const principal = await requirePrincipal(context);
    const form = await context.req.raw.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new WorkerHttpError(
        422,
        "ASSET_FILE_REQUIRED",
        "multipart 请求必须提供 file 字段",
      );
    }
    const repository = new D1AssetRepository(context.env.DB, context.env.UPLOADS);
    const result = await repository.upload(file, principal);
    return context.json(response("uploadAsset", 201, result), 201);
  });

  app.get("/api/assets/:assetId", async (context) => {
    const input = params("readAsset", context.req.param()) as { assetId: string };
    const principal = await optionalPrincipal(context);
    const repository = new D1AssetRepository(context.env.DB, context.env.UPLOADS);
    return repository.read(input.assetId, context.req.raw, principal);
  });

  app.post("/api/dice", async (context) => {
    const principal = await requirePrincipal(context);
    const request = CreateDiceRollRequestSchema.parse(await body("createDiceRoll", context));
    const repository = new D1DiceRepository(context.env.DB);
    const result = await repository.create(
      request.expression,
      principal.id,
      request.rerollOf ?? null,
    );
    return context.json(response("createDiceRoll", 201, result), 201);
  });

  app.get("/api/dice/:rollId", async (context) => {
    const input = params("getDiceRoll", context.req.param()) as { rollId: string };
    const repository = new D1DiceRepository(context.env.DB);
    return context.json(response("getDiceRoll", 200, await repository.get(input.rollId)));
  });

  app.post("/api/dice/:rollId/reroll", async (context) => {
    const input = params("rerollDice", context.req.param()) as { rollId: string };
    const principal = await requirePrincipal(context);
    const repository = new D1DiceRepository(context.env.DB);
    const result = await repository.create("", principal.id, input.rollId);
    return context.json(response("rerollDice", 201, result), 201);
  });

  app.get("/api/documents", async (context) => {
    const principal = await requirePrincipal(context);
    const rows = await context.env.DB.prepare(
      "SELECT document.id, document.title, document.current_revision, document.updated_at, " +
        "CASE WHEN ? = 'moderator' OR document.created_by = ? OR EXISTS (" +
        "SELECT 1 FROM document_acl acl WHERE acl.document_id = document.id " +
        "AND acl.user_id = ? AND acl.permission IN ('edit', 'admin')) THEN 1 ELSE 0 END AS can_edit " +
        "FROM documents document ORDER BY document.updated_at DESC, document.id",
    )
      .bind(principal.role, principal.id, principal.id)
      .all<{
        id: string;
        title: string;
        current_revision: number;
        updated_at: string;
        can_edit: number;
      }>();
    return context.json(response("listDocuments", 200, {
      items: rows.results.map((row) => ({
        id: row.id,
        title: row.title,
        revision: row.current_revision,
        savedAt: row.updated_at,
        canEdit: row.can_edit === 1,
      })),
    }));
  });

  app.get("/api/documents/:documentId", async (context) => {
    const input = params("getDocument", context.req.param()) as { documentId: string };
    const principal = await requirePrincipal(context);
    const repository = new D1ReadRepository(context.env.DB);
    const document = await repository.document(input.documentId);
    const visible = await visibleEnvelope(
      context.env.DB,
      document,
      await canEditDocument(context, input.documentId, principal),
    );
    return context.json(response("getDocument", 200, visible));
  });

  app.put("/api/documents/:documentId", async (context) => {
    const input = params("updateDocument", context.req.param()) as { documentId: string };
    const request = UpdateDocumentRequestSchema.parse(await body("updateDocument", context));
    const existing = await context.env.DB.prepare("SELECT 1 AS found FROM documents WHERE id = ?")
      .bind(input.documentId)
      .first<{ found: number }>();
    const principal = existing
      ? await requireDocumentEditor(context, input.documentId)
      : await requirePrincipal(context);
    if (!existing && principal.role === "reader") {
      throw new WorkerHttpError(403, "FORBIDDEN", "只有作者或版主可以创建文章");
    }
    const repository = new D1WriteRepository(context.env.DB);
    const result = await repository.save(input.documentId, request, principal.id);
    const status = result.created ? 201 : 200;
    return context.json(response("updateDocument", status, result.envelope), status);
  });

  app.post("/api/documents/:documentId/chapters", async (context) => {
    const input = params("createDocumentChapter", context.req.param()) as {
      documentId: string;
    };
    await requireDocumentEditor(context, input.documentId);
    const request = CreateDocumentChapterRequestSchema.parse(
      await body("createDocumentChapter", context),
    );
    const repository = new D1ChapterRepository(context.env.DB);
    const result = await repository.create(input.documentId, request);
    const status = result.created ? 201 : 200;
    return context.json(response("createDocumentChapter", status, result.value), status);
  });

  app.patch("/api/documents/:documentId/chapters/:chapterId", async (context) => {
    const input = params("updateDocumentChapter", context.req.param()) as {
      documentId: string;
      chapterId: string;
    };
    await requireDocumentEditor(context, input.documentId);
    const request = UpdateDocumentChapterRequestSchema.parse(
      await body("updateDocumentChapter", context),
    );
    const repository = new D1ChapterRepository(context.env.DB);
    const result = await repository.updateHidden(
      input.documentId,
      input.chapterId,
      request.hidden,
    );
    return context.json(response("updateDocumentChapter", 200, result));
  });

  app.delete("/api/documents/:documentId/chapters/:chapterId", async (context) => {
    const input = params("deleteDocumentChapter", context.req.param()) as {
      documentId: string;
      chapterId: string;
    };
    await requireDocumentEditor(context, input.documentId);
    const repository = new D1ChapterRepository(context.env.DB);
    const result = await repository.delete(input.documentId, input.chapterId);
    return context.json(response("deleteDocumentChapter", 200, result));
  });

  app.patch("/api/documents/:documentId/steps", async (context) => {
    const input = params("updateDocumentSteps", context.req.param()) as {
      documentId: string;
    };
    const principal = await requireDocumentEditor(context, input.documentId);
    const request = UpdateDocumentStepsRequestSchema.parse(
      await body("updateDocumentSteps", context),
    );
    const repository = new D1WriteRepository(context.env.DB);
    const result = await repository.applySteps(input.documentId, request, principal.id);
    const status = result.created ? 201 : 200;
    return context.json(response("updateDocumentSteps", status, result.envelope), status);
  });

  app.post("/api/documents/:documentId/rollback", async (context) => {
    const input = params("rollbackDocument", context.req.param()) as { documentId: string };
    const principal = await requireDocumentEditor(context, input.documentId);
    const request = RollbackDocumentRequestSchema.parse(
      await body("rollbackDocument", context),
    );
    const repository = new D1WriteRepository(context.env.DB);
    const result = await repository.rollback(input.documentId, request, principal.id);
    const status = result.created ? 201 : 200;
    return context.json(response("rollbackDocument", status, result.envelope), status);
  });

  app.get("/api/documents/:documentId/revisions", async (context) => {
    await requirePrincipal(context);
    const input = params("listRevisions", context.req.param()) as { documentId: string };
    const query = RevisionQuerySchema.parse(context.req.query());
    const repository = new D1ReadRepository(context.env.DB);
    const result = await repository.revisions(
      input.documentId,
      query.cursor,
      query.limit,
      query.chapterId,
    );
    return context.json(response("listRevisions", 200, result));
  });

  app.get("/api/documents/:documentId/revisions/:revision", async (context) => {
    const input = params("getRevision", context.req.param()) as {
      documentId: string;
      revision: string;
    };
    const principal = await requirePrincipal(context);
    const repository = new D1ReadRepository(context.env.DB);
    const result = await repository.revision(input.documentId, Number(input.revision));
    const visible = await visibleEnvelope(
      context.env.DB,
      result,
      await canEditDocument(context, input.documentId, principal),
    );
    return context.json(response("getRevision", 200, visible));
  });

  app.post("/api/forum/novels/:novelId/chapters/sync", async (context) => {
    const input = params("syncNovelChapters", context.req.param()) as { novelId: string };
    await requireDocumentEditor(context, input.novelId);
    const request = SyncNovelChaptersRequestSchema.parse(
      await body("syncNovelChapters", context),
    );
    const repository = new D1ChapterRepository(context.env.DB);
    const result = await repository.syncHashes(input.novelId, request.chapters);
    return context.json(response("syncNovelChapters", 200, result));
  });

  app.get("/api/forum/novels/:novelId/chapters/:chapterId", async (context) => {
    const input = params("getNovelChapter", context.req.param()) as {
      novelId: string;
      chapterId: string;
    };
    const principal = await requirePrincipal(context);
    const repository = new D1ChapterRepository(context.env.DB);
    const chapter = await repository.content(input.novelId, input.chapterId);
    if (
      chapter.hidden &&
      !(await canEditDocument(context, chapter.documentId, principal))
    )
      throw new WorkerHttpError(404, "CHAPTER_NOT_FOUND", "章节正文不存在");
    return context.json(chapter);
  });

  app.put("/api/forum/novels/:novelId/chapters/:chapterId", async (context) => {
    const input = params("saveNovelChapter", context.req.param()) as {
      novelId: string;
      chapterId: string;
    };
    await requireDocumentEditor(context, input.novelId);
    const request = SaveNovelChapterRequestSchema.parse(
      await body("saveNovelChapter", context),
    );
    const repository = new D1ChapterRepository(context.env.DB);
    const result = await repository.save(input.novelId, input.chapterId, request);
    return context.json(response("saveNovelChapter", 201, result), 201);
  });

  app.post("/api/forum/novels/:novelId/chapters/batch", async (context) => {
    const input = params("saveNovelChaptersBatch", context.req.param()) as {
      novelId: string;
    };
    await requireDocumentEditor(context, input.novelId);
    const request = await limitedBatchBody<SaveNovelChaptersBatchRequest>(
      "saveNovelChaptersBatch",
      context,
      SaveNovelChaptersBatchRequestSchema,
    );
    const repository = new D1ChapterRepository(context.env.DB);
    const result = await repository.saveBatch(input.novelId, request.chapters);
    return context.json(
      response("saveNovelChaptersBatch", 200, { chapters: result }),
    );
  });

  app.post(
    "/api/forum/novels/:novelId/chapters/reorder-stage",
    async (context) => {
      const input = params("stageNovelChapterReorder", context.req.param()) as {
        novelId: string;
      };
      await requireDocumentEditor(context, input.novelId);
      const request = await limitedBatchBody<StageNovelChapterReorderRequest>(
        "stageNovelChapterReorder",
        context,
        StageNovelChapterReorderRequestSchema,
      );
      const repository = new D1ChapterRepository(context.env.DB);
      const result = await repository.stageReorder(input.novelId, request.chapters);
      return context.json(
        response("stageNovelChapterReorder", 200, { chapters: result }),
      );
    },
  );

  app.get("/api/documents/:documentId/comments/:anchorId", async (context) => {
    const input = params("getCommentThread", context.req.param()) as {
      documentId: string;
      anchorId: string;
    };
    const principal = await requirePrincipal(context);
    const raw = context.req.query();
    const page = CursorQuerySchema.parse({
      ...(raw.cursor ? { cursor: raw.cursor } : {}),
      ...(raw.limit ? { limit: raw.limit } : {}),
    });
    const sort = CommentSortSchema.parse(raw.sort ?? "score");
    const repository = new D1CommentRepository(context.env.DB);
    const result = await repository.thread(
      input.documentId,
      input.anchorId,
      principal.id,
      sort,
      page.cursor,
      page.limit,
    );
    return context.json(response("getCommentThread", 200, result));
  });

  app.post("/api/documents/:documentId/comments/:anchorId/replies", async (context) => {
    const input = params("createCommentReply", context.req.param()) as {
      documentId: string;
      anchorId: string;
    };
    const principal = await requirePrincipal(context);
    const request = CreateCommentReplyRequestSchema.parse(
      await body("createCommentReply", context),
    );
    const repository = new D1CommentRepository(context.env.DB);
    const result = await repository.createReply(
      input.documentId,
      input.anchorId,
      request.parentId,
      request.body,
      principal,
    );
    return context.json(response("createCommentReply", 201, result), 201);
  });

  app.put("/api/comments/replies/:replyId/vote", async (context) => {
    const input = params("voteComment", context.req.param()) as { replyId: string };
    const principal = await requirePrincipal(context);
    const request = VoteCommentRequestSchema.parse(await body("voteComment", context));
    const repository = new D1CommentRepository(context.env.DB);
    const result = await repository.vote(input.replyId, principal.id, request.value);
    return context.json(response("voteComment", 200, result));
  });

  app.get("/api/forum/users/search", async (context) => {
    await requirePrincipal(context);
    const request = parseQuery("searchMentionUsers", context.req.query()) as {
      q: string;
      friendsOnly: boolean;
    };
    const repository = new D1ForumRepository(context.env.DB);
    const items = await repository.searchUsers(request.q, request.friendsOnly);
    return context.json(response("searchMentionUsers", 200, { items }));
  });

  app.post("/api/forum/mentions/resolve", async (context) => {
    await requirePrincipal(context);
    const request = ResolveMentionRequestSchema.parse(await body("resolveMention", context));
    const repository = new D1ForumRepository(context.env.DB);
    const result = await repository.resolveMention(request.name, request.userId);
    return context.json(response("resolveMention", 200, result));
  });

  app.post("/api/forum/reply-gates/resolve", async (context) => {
    const principal = await requirePrincipal(context);
    const request = ResolveReplyGateRequestSchema.parse(
      await body("resolveReplyGate", context),
    );
    const repository = new D1ForumRepository(context.env.DB);
    const result = await repository.resolveReplyGate(
      request.gateId,
      request.documentId,
      principal,
    );
    return context.json(response("resolveReplyGate", 200, result));
  });

  app.get("/api/forum/attachments/:attachmentId", async (context) => {
    const input = params("getAttachment", context.req.param()) as { attachmentId: string };
    const principal = await requirePrincipal(context);
    const repository = new D1AttachmentRepository(context.env.DB);
    const result = await repository.attachment(input.attachmentId, principal);
    return context.json(response("getAttachment", 200, result));
  });

  app.post("/api/forum/attachments/:attachmentId/purchase", async (context) => {
    const input = params("purchaseAttachment", context.req.param()) as {
      attachmentId: string;
    };
    const principal = await requirePrincipal(context);
    const repository = new D1AttachmentRepository(context.env.DB);
    const result = await repository.purchase(input.attachmentId, principal);
    return context.json(response("purchaseAttachment", 200, result));
  });

  app.get("/api/forum/polls/:pollId", async (context) => {
    const input = params("getPoll", context.req.param()) as { pollId: string };
    const principal = await requirePrincipal(context);
    const repository = new D1PollRepository(context.env.DB);
    const result = await repository.poll(input.pollId, principal);
    return context.json(response("getPoll", 200, result));
  });

  app.post("/api/forum/polls/:pollId/votes", async (context) => {
    const input = params("submitPollVote", context.req.param()) as { pollId: string };
    const principal = await requirePrincipal(context);
    const request = SubmitPollVoteRequestSchema.parse(
      await body("submitPollVote", context),
    );
    const repository = new D1PollRepository(context.env.DB);
    const result = await repository.submit(input.pollId, request.optionIds, principal);
    return context.json(response("submitPollVote", 200, result));
  });

  app.get("/api/forum/polls/:pollId/votes", async (context) => {
    const input = params("listPollVotes", context.req.param()) as { pollId: string };
    await requirePrincipal(context);
    const page = CursorQuerySchema.parse(context.req.query());
    const repository = new D1PollRepository(context.env.DB);
    const result = await repository.votes(input.pollId, page.cursor, page.limit);
    return context.json(response("listPollVotes", 200, result));
  });

  app.get("/api/forum/documents/:documentId/suggestions", async (context) => {
    const input = params("listSuggestions", context.req.param()) as { documentId: string };
    const principal = await requirePrincipal(context);
    const repository = new D1SuggestionRepository(context.env.DB);
    const items = await repository.suggestions(input.documentId, principal);
    return context.json(response("listSuggestions", 200, { items }));
  });

  app.post("/api/forum/documents/:documentId/suggestions", async (context) => {
    const input = params("createSuggestion", context.req.param()) as { documentId: string };
    const principal = await requirePrincipal(context);
    const request = CreateSuggestionRequestSchema.parse(
      await body("createSuggestion", context),
    );
    const repository = new D1SuggestionRepository(context.env.DB);
    const result = await repository.createSuggestion(input.documentId, request, principal);
    return context.json(response("createSuggestion", 201, result), 201);
  });

  app.get("/api/forum/documents/:documentId/suggestion-batches", async (context) => {
    const input = params("listSuggestionBatches", context.req.param()) as {
      documentId: string;
    };
    const principal = await requirePrincipal(context);
    const repository = new D1SuggestionRepository(context.env.DB);
    const items = await repository.batches(input.documentId, principal);
    return context.json(response("listSuggestionBatches", 200, { items }));
  });

  app.post("/api/forum/documents/:documentId/suggestion-batches", async (context) => {
    const input = params("createSuggestionBatch", context.req.param()) as {
      documentId: string;
    };
    const principal = await requirePrincipal(context);
    const request = CreateSuggestionBatchRequestSchema.parse(
      await body("createSuggestionBatch", context),
    );
    const repository = new D1SuggestionRepository(context.env.DB);
    const result = await repository.createBatch(input.documentId, request, principal);
    return context.json(response("createSuggestionBatch", 201, result), 201);
  });

  app.patch("/api/forum/suggestions/:suggestionId", async (context) => {
    const input = params("reviewSuggestion", context.req.param()) as { suggestionId: string };
    const repository = new D1SuggestionRepository(context.env.DB);
    const documentId = await repository.suggestionDocument(input.suggestionId);
    const reviewer = await requireDocumentEditor(context, documentId);
    const request = ReviewSuggestionRequestSchema.parse(
      await body("reviewSuggestion", context),
    );
    const result = await repository.reviewSuggestion(
      input.suggestionId,
      request.decision,
      request.baseRevision,
      reviewer,
    );
    return context.json(response("reviewSuggestion", 200, result));
  });

  app.patch("/api/forum/suggestion-batches/:batchId", async (context) => {
    const input = params("reviewSuggestionBatch", context.req.param()) as { batchId: string };
    const repository = new D1SuggestionRepository(context.env.DB);
    const documentId = await repository.batchDocument(input.batchId);
    const reviewer = await requireDocumentEditor(context, documentId);
    const request = ReviewSuggestionBatchRequestSchema.parse(
      await body("reviewSuggestionBatch", context),
    );
    const result = await repository.reviewBatch(
      input.batchId,
      request.decision,
      request.baseRevision,
      reviewer,
    );
    return context.json(response("reviewSuggestionBatch", 200, result));
  });

  app.get("/api/forum/chapters", async (context) => {
    const principal = await requirePrincipal(context);
    const input = parseQuery("listChapters", context.req.query()) as { documentId: string };
    const repository = new D1ReadRepository(context.env.DB);
    const items = [];
    for (const chapter of await repository.chapters(input.documentId)) {
      if (!chapter.hidden || (await canEditDocument(context, chapter.documentId, principal))) {
        items.push(chapter);
      }
    }
    return context.json(response("listChapters", 200, { items }));
  });

  app.get("/api/forum/session", async (context) => {
    const principal = await requirePrincipal(context);
    const current = await sessionUser(context, principal);
    const available = await availableUsers(context, principal);
    return context.json(response("getForumSession", 200, { current, available }));
  });

  app.notFound((context) =>
    context.json(
      errorPayload(new WorkerHttpError(404, "ROUTE_NOT_FOUND", "请求的接口不存在")),
      404,
    ),
  );

  app.onError((error, context) => {
    if (error instanceof WorkerHttpError) {
      return context.json(errorPayload(error), error.status as ContentfulStatusCode);
    }
    if (error instanceof DomainError) {
      const adapted = new WorkerHttpError(error.status, error.code, error.message, error.details);
      return context.json(errorPayload(adapted), error.status as ContentfulStatusCode);
    }
    const candidate = error as { issues?: unknown; message?: string };
    if (Array.isArray(candidate.issues)) {
      return context.json(
        errorPayload(
          new WorkerHttpError(422, "VALIDATION_ERROR", "请求字段校验失败", {
            issue: candidate.message ?? "字段格式不正确",
          }),
        ),
        422,
      );
    }
    console.error(
      JSON.stringify({
        level: "error",
        requestId: context.get("requestId"),
        message: error.message,
        stack: error.stack,
      }),
    );
    return context.json(
      errorPayload(new WorkerHttpError(500, "INTERNAL_ERROR", "服务器处理请求时发生错误")),
      500,
    );
  });

  return app;
}
