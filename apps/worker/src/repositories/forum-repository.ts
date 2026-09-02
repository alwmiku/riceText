import { ForumUserSchema, type ForumUser } from "@ricetext/contracts";
import { repairDocumentForRead } from "@ricetext/server-core";
import { WorkerHttpError } from "../http-error";

type UserRow = {
  id: string;
  name: string;
  role: "author" | "reader" | "moderator";
  is_friend: number;
  bio: string;
};

function user(row: UserRow): ForumUser {
  return ForumUserSchema.parse({
    id: row.id,
    name: row.name,
    role: row.role,
    isFriend: row.is_friend === 1,
    bio: row.bio,
  });
}

/** 聚合回复门禁、用户检索等轻量论坛读取，持久化 JSON 在返回前统一修复。 */
export class D1ForumRepository {
  constructor(private readonly db: D1Database) {}

  async searchUsers(query: string, friendsOnly: boolean): Promise<ForumUser[]> {
    const normalized = "%" + query.toLocaleLowerCase() + "%";
    const result = await this.db
      .prepare(
        "SELECT id, name, role, is_friend, bio FROM users " +
          "WHERE (lower(id) LIKE ? OR lower(name) LIKE ?) " +
          "AND (? = 0 OR is_friend = 1) " +
          "ORDER BY is_friend DESC, name LIMIT 20",
      )
      .bind(normalized, normalized, friendsOnly ? 1 : 0)
      .all<UserRow>();
    return result.results.map(user);
  }

  async resolveMention(
    name: string,
    userId: string | undefined,
  ): Promise<{ resolved: boolean; displayText: string; user: ForumUser | null }> {
    const row = userId
      ? await this.db
          .prepare("SELECT id, name, role, is_friend, bio FROM users WHERE id = ?")
          .bind(userId)
          .first<UserRow>()
      : await this.db
          .prepare(
            "SELECT id, name, role, is_friend, bio FROM users WHERE lower(name) = lower(?)",
          )
          .bind(name)
          .first<UserRow>();
    return {
      resolved: Boolean(row),
      displayText: "@" + (row?.name ?? name),
      user: row ? user(row) : null,
    };
  }

  async resolveReplyGate(
    gateId: string,
    documentId: string,
    principal: ForumUser,
  ): Promise<{ visible: boolean; content: ReturnType<typeof repairDocumentForRead> | null; message: string }> {
    const row = await this.db
      .prepare("SELECT document_id, content_json FROM reply_gates WHERE id = ?")
      .bind(gateId)
      .first<{ document_id: string; content_json: string }>();
    if (!row || row.document_id !== documentId) {
      throw new WorkerHttpError(404, "REPLY_GATE_NOT_FOUND", "回复可见内容不存在");
    }
    const receipt =
      principal.role === "reader"
        ? await this.db
            .prepare(
              "SELECT 1 AS found FROM reply_receipts WHERE document_id = ? AND user_id = ?",
            )
            .bind(documentId, principal.id)
            .first<{ found: number }>()
        : { found: 1 };
    const visible = Boolean(receipt);
    return {
      visible,
      content: visible ? repairDocumentForRead(JSON.parse(row.content_json)) : null,
      message: visible ? "已满足查看条件" : "回复主帖后可见",
    };
  }
}
