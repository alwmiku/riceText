import type { DatabaseSync } from "node:sqlite";
import type { AuthProvider } from "../auth.js";
import type { CommentService } from "../comment-service.js";
import type { ForumService } from "../forum-service.js";
import type { DiceService } from "../dice-service.js";
import type { DocumentService } from "../document-service.js";

/** 所有路由共享同一组服务实例，避免插件内部重复创建数据库服务。 */
export interface RouteDependencies {
  readonly db: DatabaseSync;
  readonly documents: DocumentService;
  readonly dice: DiceService;
  readonly comments: CommentService;
  readonly forum: ForumService;
  readonly auth: AuthProvider;
  readonly uploadsDirectory: string;
}
