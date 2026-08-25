import type { FastifyRequest } from "fastify";
import type { ForumUser } from "@ricetext/contracts";
import type { DatabaseSync } from "node:sqlite";

/** 每个请求解析出的身份；生产可替换为 JWT/SSO。 */
export type RequestIdentity = ForumUser;

/** 可替换的身份解析边界。 */
export interface AuthProvider {
  resolve(request: FastifyRequest): RequestIdentity;
}

interface UserRow { id: string; name: string; role: "author" | "reader" | "moderator"; is_friend: number; bio: string; }

/** 使用 x-user-id 头选择 SQLite 种子身份的开发适配器。 */
export class HeaderForumAuthProvider implements AuthProvider {
  readonly #db: DatabaseSync;

  /** 绑定保存论坛身份的数据库。 */
  constructor(db: DatabaseSync) { this.#db = db; }

  /** 解析请求；无效或缺失的头会回退到 reader。 */
  resolve(request: FastifyRequest): RequestIdentity {
    const raw = request.headers["x-user-id"];
    const requestedId = typeof raw === "string" ? raw : "reader";
    const row = (this.#db.prepare("SELECT id, name, role, is_friend, bio FROM users WHERE id = ?").get(requestedId)
      ?? this.#db.prepare("SELECT id, name, role, is_friend, bio FROM users WHERE id = 'reader'").get()) as unknown as UserRow;
    return { id: row.id, name: row.name, role: row.role, isFriend: row.is_friend === 1, bio: row.bio };
  }
}
