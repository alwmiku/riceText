import type { DatabaseSync } from "node:sqlite";
import type { ForumSessionUser, ForumUser } from "@ricetext/contracts";
import { mapUser, type UserRow } from "./shared.js";

type SessionRow = UserRow & { coins: number; replied: number };

function mapSessionUser(row: SessionRow): ForumSessionUser {
  return {
    ...mapUser(row),
    avatar: Array.from(row.name)[0] ?? "用",
    coins: Number(row.coins),
    replied: row.replied === 1,
  };
}

export class SessionService {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** 可用于开发身份切换器的用户列表。 */
  users(): ForumSessionUser[] {
    const rows = this.#db
      .prepare(
        "SELECT user.id, user.name, user.role, user.is_friend, user.bio, " +
          "COALESCE(wallet.balance, 0) AS coins, " +
          "EXISTS(SELECT 1 FROM reply_receipts receipt WHERE receipt.user_id = user.id) AS replied " +
          "FROM users user LEFT JOIN wallets wallet ON wallet.user_id = user.id " +
          "ORDER BY CASE user.role WHEN 'author' THEN 1 WHEN 'reader' THEN 2 ELSE 3 END, user.id",
      )
      .all() as unknown as SessionRow[];
    return rows.map(mapSessionUser);
  }

  sessionUser(identity: ForumUser): ForumSessionUser {
    const row = this.#db
      .prepare(
        "SELECT user.id, user.name, user.role, user.is_friend, user.bio, " +
          "COALESCE(wallet.balance, 0) AS coins, " +
          "EXISTS(SELECT 1 FROM reply_receipts receipt WHERE receipt.user_id = user.id) AS replied " +
          "FROM users user LEFT JOIN wallets wallet ON wallet.user_id = user.id WHERE user.id = ?",
      )
      .get(identity.id) as unknown as SessionRow;
    return mapSessionUser(row);
  }

  /** 搜索名称或 ID，可限制为好友。 */
  searchUsers(query: string, friendsOnly: boolean): ForumUser[] {
    const normalized = `%${query.toLocaleLowerCase()}%`;
    const rows = this.#db
      .prepare(
        "SELECT id, name, role, is_friend, bio FROM users WHERE (lower(id) LIKE ? OR lower(name) LIKE ?) AND (? = 0 OR is_friend = 1) ORDER BY is_friend DESC, name LIMIT 20",
      )
      .all(normalized, normalized, friendsOnly ? 1 : 0) as unknown as UserRow[];
    return rows.map(mapUser);
  }

  /** 按 ID 优先、名称其次解析 @。 */
  resolveMention(
    name: string,
    userId: string | undefined,
  ): { resolved: boolean; displayText: string; user: ForumUser | null } {
    const row = (userId
      ? this.#db
          .prepare(
            "SELECT id, name, role, is_friend, bio FROM users WHERE id = ?",
          )
          .get(userId)
      : this.#db
          .prepare(
            "SELECT id, name, role, is_friend, bio FROM users WHERE lower(name) = lower(?)",
          )
          .get(name)) as unknown as UserRow | undefined;
    return {
      resolved: Boolean(row),
      displayText: `@${row?.name ?? name}`,
      user: row ? mapUser(row) : null,
    };
  }
}
