import { mkdir } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { HeaderForumAuthProvider, type AuthProvider } from "./auth.js";
import { CommentService } from "./comment-service.js";
import { createDatabase } from "./db.js";
import { ForumService } from "./forum-service.js";
import { DiceService } from "./dice-service.js";
import { DocumentService } from "./document-service.js";
import { registerErrorHandlers } from "./plugins/error-handlers.js";
import { assetRoutes } from "./routes/assets.js";
import { commentRoutes } from "./routes/comments.js";
import type { RouteDependencies } from "./routes/dependencies.js";
import { forumAttachmentRoutes } from "./routes/forum/attachments.js";
import { forumChapterRoutes } from "./routes/forum/chapters.js";
import { forumPollRoutes } from "./routes/forum/polls.js";
import { forumSessionRoutes } from "./routes/forum/session.js";
import { forumSuggestionRoutes } from "./routes/forum/suggestions.js";
import { diceRoutes } from "./routes/dice.js";
import { documentRoutes } from "./routes/documents.js";

/** 创建 API 实例的可注入选项。 */
export interface CreateAppOptions {
  /** SQLite 文件路径；测试可传 `:memory:` 或临时路径。 */
  databasePath: string;
  /** 图片二进制保存目录。 */
  uploadsDirectory: string;
  /** 是否写入幂等实时数据，默认 true。 */
  seed?: boolean;
  /** Fastify 日志配置，测试默认关闭。 */
  logger?: boolean;
  /** 可替换身份解析器，生产环境在此接入 JWT/SSO。 */
  authProvider?: AuthProvider;
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
  const dependencies: RouteDependencies = {
    db,
    documents,
    dice: new DiceService(db),
    comments: new CommentService(db),
    forum: new ForumService(db, documents),
    auth: options.authProvider ?? new HeaderForumAuthProvider(db),
    uploadsDirectory: options.uploadsDirectory,
  };

  await mkdir(options.uploadsDirectory, { recursive: true });
  await app.register(cors, {
    origin: true,
    credentials: true,
    allowedHeaders: ["content-type", "x-user-id"],
  });
  await app.register(multipart, {
    limits: { files: 1, fileSize: 8 * 1024 * 1024, fields: 4 },
  });

  // 错误处理器必须注册在父作用域，才能覆盖所有封装后的路由插件。
  registerErrorHandlers(app);
  app.addHook("onClose", async () => {
    db.close();
  });

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

  // 每个插件接收同一组服务实例，路由层不拥有服务生命周期。
  await app.register(documentRoutes, dependencies);
  await app.register(assetRoutes, dependencies);
  await app.register(diceRoutes, dependencies);
  await app.register(commentRoutes, dependencies);
  await app.register(forumSessionRoutes, dependencies);
  await app.register(forumChapterRoutes, dependencies);
  await app.register(forumSuggestionRoutes, dependencies);
  await app.register(forumAttachmentRoutes, dependencies);
  await app.register(forumPollRoutes, dependencies);

  return app;
}
