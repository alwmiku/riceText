import { createReadStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import {
  CreateCommentReplyRequestSchema,
  CreateDiceRollRequestSchema,
  CreateSuggestionRequestSchema,
  CursorQuerySchema,
  ResolveMentionRequestSchema,
  ResolveReplyGateRequestSchema,
  ReviewSuggestionRequestSchema,
  RollbackDocumentRequestSchema,
  SubmitPollVoteRequestSchema,
  UpdateDocumentRequestSchema,
  VoteCommentRequestSchema,
  getFastifySchema as getContractFastifySchema,
} from "@ricetext/contracts";
import {
  HeaderDemoAuthProvider,
  type AuthProvider,
  type RequestIdentity,
} from "./auth.js";
import { createDatabase } from "./db.js";
import { DocumentService } from "./document-service.js";
import { DiceService } from "./dice-service.js";
import { CommentService } from "./comment-service.js";
import { DemoService } from "./demo-service.js";
import { HttpError, sendHttpError } from "./errors.js";

/** 创建 API 实例的可注入选项。 */
export interface CreateAppOptions {
  /** SQLite 文件路径；测试可传 `:memory:` 或临时路径。 */
  databasePath: string;
  /** 图片二进制保存目录。 */
  uploadsDirectory: string;
  /** 是否写入幂等演示数据，默认 true。 */
  seed?: boolean;
  /** Fastify 日志配置，测试默认关闭。 */
  logger?: boolean;
  /** 可替换身份解析器，生产环境在此接入 JWT/SSO。 */
  authProvider?: AuthProvider;
}

interface AssetRow {
  id: string;
  original_name: string;
  stored_name: string;
  mime_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  byte_size: number;
  created_at: string;
}

function params(request: FastifyRequest): Record<string, string> {
  return request.params as Record<string, string>;
}
/** 把 Fastify 的 unknown query 收窄为共享 Zod schema 可解析的键值结构。 */
function query(
  request: FastifyRequest,
): Record<string, string | number | boolean | undefined> {
  return request.query as Record<string, string | number | boolean | undefined>;
}

/**
 * 复用契约生成的 route schema；querystring 由路由显式 Zod parse，避免 Ajv 与 Zod
 * 对 default/coerce 的解释差异导致运行时和 OpenAPI 漂移。
 */
function getFastifySchema(operationId: string): Record<string, unknown> {
  const { querystring: _querystring, ...schema } =
    getContractFastifySchema(operationId);
  return schema;
}

/** 通过文件魔数识别图片，不能只信任客户端声明的 MIME。 */
function detectImageMime(buffer: Buffer): AssetRow["mime_type"] | null {
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  )
    return "image/jpeg";
  if (
    buffer.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))
  )
    return "image/gif";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return null;
}

function extensionFor(mime: AssetRow["mime_type"]): string {
  return {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
  }[mime];
}

/** 创建可供测试 inject 或 server.ts 监听的 Fastify 应用。 */
export async function createApp(
  options: CreateAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    ajv: { customOptions: { coerceTypes: false, useDefaults: false } },
  });
  const db = createDatabase({
    path: options.databasePath,
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  });
  const documents = new DocumentService(db);
  const dice = new DiceService(db);
  const comments = new CommentService(db);
  const demo = new DemoService(db, documents);
  const auth = options.authProvider ?? new HeaderDemoAuthProvider(db);
  await mkdir(options.uploadsDirectory, { recursive: true });

  await app.register(cors, {
    origin: true,
    credentials: true,
    allowedHeaders: ["content-type", "x-demo-user"],
  });
  await app.register(multipart, {
    limits: { files: 1, fileSize: 8 * 1024 * 1024, fields: 4 },
  });
  app.addHook("onClose", async () => {
    db.close();
  });

  const identity = (request: FastifyRequest): RequestIdentity =>
    auth.resolve(request);
  const requireEditor = (request: FastifyRequest): RequestIdentity => {
    const user = identity(request);
    if (user.role === "reader")
      throw new HttpError(403, "FORBIDDEN", "只有作者或版主可以修改文档");
    return user;
  };

  // 所有异常统一成共享 ApiError 形状；上传大小和 schema 校验映射为稳定状态码。
  app.setErrorHandler((error, _request, reply) => {
    const candidate = error as {
      code?: string;
      validation?: unknown;
      issues?: unknown;
      message?: string;
    };
    if (error instanceof HttpError) return sendHttpError(reply, error);
    if (candidate.code === "FST_REQ_FILE_TOO_LARGE")
      return sendHttpError(
        reply,
        new HttpError(413, "ASSET_TOO_LARGE", "图片不能超过 8 MiB"),
      );
    if (candidate.validation !== undefined || Array.isArray(candidate.issues))
      return sendHttpError(
        reply,
        new HttpError(422, "VALIDATION_ERROR", "请求字段校验失败", {
          issue: candidate.message ?? "字段格式不正确",
        }),
      );
    app.log.error(error);
    return sendHttpError(
      reply,
      new HttpError(500, "INTERNAL_ERROR", "服务器处理请求时发生错误"),
    );
  });
  app.setNotFoundHandler((_request, reply) =>
    sendHttpError(
      reply,
      new HttpError(404, "ROUTE_NOT_FOUND", "请求的接口不存在"),
    ),
  );

  // 健康检查不依赖业务数据，供本地启动和部署探针使用。
  app.get(
    "/health",
    {
      schema: {
        summary: "健康检查",
        response: {
          200: { type: "object", properties: { ok: { type: "boolean" } } },
        },
      },
    },
    async () => ({ ok: true }),
  );

  // 文档、revision 和回滚是真实持久化核心，所有写入都要求作者或版主身份。
  app.get(
    "/api/documents/:documentId",
    { schema: getFastifySchema("getDocument") },
    async (request) => documents.get(params(request).documentId!),
  );
  app.put(
    "/api/documents/:documentId",
    { schema: getFastifySchema("updateDocument") },
    async (request, reply) => {
      const user = requireEditor(request);
      const body = UpdateDocumentRequestSchema.parse(request.body);
      const result = documents.save(params(request).documentId!, body, user.id);
      return reply.status(result.created ? 201 : 200).send(result.envelope);
    },
  );
  app.get(
    "/api/documents/:documentId/revisions",
    { schema: getFastifySchema("listRevisions") },
    async (request) => {
      const input = CursorQuerySchema.parse(query(request));
      return documents.revisions(
        params(request).documentId!,
        input.cursor,
        input.limit,
      );
    },
  );
  app.post(
    "/api/documents/:documentId/rollback",
    { schema: getFastifySchema("rollbackDocument") },
    async (request, reply) => {
      const user = requireEditor(request);
      const body = RollbackDocumentRequestSchema.parse(request.body);
      const result = documents.rollback(
        params(request).documentId!,
        body,
        user.id,
      );
      return reply.status(result.created ? 201 : 200).send(result.envelope);
    },
  );

  // 图片二进制独立于正文 JSON，数据库只保存白名单元数据和不可猜测的本地文件名。
  app.post(
    "/api/assets",
    { schema: getFastifySchema("uploadAsset") },
    async (request, reply) => {
      const user = identity(request);
      const file = await request.file();
      if (!file)
        throw new HttpError(
          422,
          "ASSET_FILE_REQUIRED",
          "multipart 请求必须提供 file 字段",
        );
      const buffer = await file.toBuffer();
      const detected = detectImageMime(buffer);
      if (!detected || detected !== file.mimetype)
        throw new HttpError(
          415,
          "UNSUPPORTED_IMAGE",
          "仅支持签名与 MIME 一致的 PNG/JPEG/GIF/WebP 图片",
        );
      const id = randomUUID();
      const storedName = `${id}.${extensionFor(detected)}`;
      const originalName =
        Array.from(basename(file.filename), (character) => {
          const code = character.codePointAt(0) ?? 0;
          return code < 32 || code === 127 ? "_" : character;
        })
          .join("")
          .slice(0, 255) || storedName;
      const createdAt = new Date().toISOString();
      const target = join(options.uploadsDirectory, storedName);
      await writeFile(target, buffer, { flag: "wx" });
      try {
        db.prepare(
          "INSERT INTO assets(id, original_name, stored_name, mime_type, byte_size, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(
          id,
          originalName,
          storedName,
          detected,
          buffer.length,
          user.id,
          createdAt,
        );
      } catch (error) {
        await unlink(target).catch(() => undefined);
        throw error;
      }
      return reply
        .status(201)
        .send({
          id,
          assetId: id,
          fileName: originalName,
          name: originalName,
          mimeType: detected,
          byteSize: buffer.length,
          size: buffer.length,
          url: `/api/assets/${id}`,
          createdAt,
        });
    },
  );
  app.get(
    "/api/assets/:assetId",
    { schema: getFastifySchema("readAsset") },
    async (request, reply) => {
      const row = db
        .prepare(
          "SELECT id, original_name, stored_name, mime_type, byte_size, created_at FROM assets WHERE id = ?",
        )
        .get(params(request).assetId!) as unknown as AssetRow | undefined;
      if (!row) throw new HttpError(404, "ASSET_NOT_FOUND", "图片资产不存在");
      reply
        .type(row.mime_type)
        .header("content-length", row.byte_size)
        .header("cache-control", "public, max-age=31536000, immutable")
        .header(
          "content-disposition",
          `inline; filename="${encodeURIComponent(row.original_name)}"`,
        );
      return reply.send(
        createReadStream(join(options.uploadsDirectory, row.stored_name)),
      );
    },
  );

  // 骰子结果由服务端生成并持久化；读取同一 rollId 永远不会重新求值。
  app.post(
    "/api/dice",
    { schema: getFastifySchema("createDiceRoll") },
    async (request, reply) => {
      const body = CreateDiceRollRequestSchema.parse(request.body);
      return reply
        .status(201)
        .send(
          body.rerollOf
            ? dice.reroll(body.rerollOf, identity(request).id)
            : dice.create(body.expression, identity(request).id),
        );
    },
  );
  app.get(
    "/api/dice/:rollId",
    { schema: getFastifySchema("getDiceRoll") },
    async (request) => dice.get(params(request).rollId!),
  );
  app.post(
    "/api/dice/:rollId/reroll",
    { schema: getFastifySchema("rerollDice") },
    async (request, reply) =>
      reply
        .status(201)
        .send(dice.reroll(params(request).rollId!, identity(request).id)),
  );

  // 间贴树按正文 anchorId 关联，锚点从正文删除后线程保留为只读归档。
  app.get(
    "/api/documents/:documentId/comments/:anchorId",
    { schema: getFastifySchema("getCommentThread") },
    async (request) => {
      const input = query(request);
      const page = CursorQuerySchema.parse({
        ...(typeof input.cursor === "string" ? { cursor: input.cursor } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      });
      return comments.getThread(
        params(request).documentId!,
        params(request).anchorId!,
        identity(request).id,
        input.sort === "newest" ? "newest" : "score",
        page.cursor,
        page.limit,
      );
    },
  );
  app.post(
    "/api/documents/:documentId/comments/:anchorId/replies",
    { schema: getFastifySchema("createCommentReply") },
    async (request, reply) => {
      const body = CreateCommentReplyRequestSchema.parse(request.body);
      return reply
        .status(201)
        .send(
          comments.reply(
            params(request).documentId!,
            params(request).anchorId!,
            body.parentId,
            body.body,
            identity(request),
          ),
        );
    },
  );
  app.put(
    "/api/comments/replies/:replyId/vote",
    { schema: getFastifySchema("voteComment") },
    async (request) => {
      const body = VoteCommentRequestSchema.parse(request.body);
      return comments.vote(
        params(request).replyId!,
        identity(request).id,
        body.value,
      );
    },
  );

  // 下列路由遵守正式契约，但属于首版演示业务，不代表生产鉴权、账务或通知实现。
  app.get(
    "/api/demo/session",
    { schema: getFastifySchema("getDemoSession") },
    async (request) => ({
      current: identity(request),
      available: demo.users(),
    }),
  );
  app.get(
    "/api/demo/chapters",
    { schema: getFastifySchema("listChapters") },
    async () => ({ items: demo.chapters() }),
  );
  app.get(
    "/api/demo/documents/:documentId/suggestions",
    { schema: getFastifySchema("listSuggestions") },
    async (request) => ({
      items: demo.suggestions(params(request).documentId!, identity(request)),
    }),
  );
  app.post(
    "/api/demo/documents/:documentId/suggestions",
    { schema: getFastifySchema("createSuggestion") },
    async (request, reply) => {
      const body = CreateSuggestionRequestSchema.parse(request.body);
      return reply
        .status(201)
        .send(
          demo.createSuggestion(
            params(request).documentId!,
            body.fromText,
            body.toText,
            body.reason,
            identity(request),
          ),
        );
    },
  );
  app.patch(
    "/api/demo/suggestions/:suggestionId",
    { schema: getFastifySchema("reviewSuggestion") },
    async (request) => {
      const body = ReviewSuggestionRequestSchema.parse(request.body);
      return demo.reviewSuggestion(
        params(request).suggestionId!,
        body.decision,
        body.baseRevision,
        identity(request),
      );
    },
  );
  app.get(
    "/api/demo/users/search",
    { schema: getFastifySchema("searchMentionUsers") },
    async (request) => {
      const input = query(request);
      return {
        items: demo.searchUsers(
          typeof input.q === "string" ? input.q : "",
          input.friendsOnly === true || input.friendsOnly === "true",
        ),
      };
    },
  );
  app.post(
    "/api/demo/mentions/resolve",
    { schema: getFastifySchema("resolveMention") },
    async (request) => {
      const body = ResolveMentionRequestSchema.parse(request.body);
      return demo.resolveMention(body.name, body.userId);
    },
  );
  app.post(
    "/api/demo/reply-gates/resolve",
    { schema: getFastifySchema("resolveReplyGate") },
    async (request) => {
      const body = ResolveReplyGateRequestSchema.parse(request.body);
      return demo.replyGate(body.gateId, body.documentId, identity(request));
    },
  );
  app.get(
    "/api/demo/attachments/:attachmentId",
    { schema: getFastifySchema("getAttachment") },
    async (request) =>
      demo.attachment(params(request).attachmentId!, identity(request)),
  );
  app.post(
    "/api/demo/attachments/:attachmentId/purchase",
    { schema: getFastifySchema("purchaseAttachment") },
    async (request) =>
      demo.purchaseAttachment(params(request).attachmentId!, identity(request)),
  );
  app.get(
    "/api/demo/polls/:pollId",
    { schema: getFastifySchema("getPoll") },
    async (request) => demo.poll(params(request).pollId!, identity(request)),
  );
  app.post(
    "/api/demo/polls/:pollId/votes",
    { schema: getFastifySchema("submitPollVote") },
    async (request) => {
      const body = SubmitPollVoteRequestSchema.parse(request.body);
      return demo.votePoll(
        params(request).pollId!,
        body.optionIds,
        identity(request),
      );
    },
  );
  app.get(
    "/api/demo/polls/:pollId/votes",
    { schema: getFastifySchema("listPollVotes") },
    async (request) => {
      const input = CursorQuerySchema.parse(query(request));
      return demo.pollVotes(params(request).pollId!, input.cursor, input.limit);
    },
  );

  return app;
}
