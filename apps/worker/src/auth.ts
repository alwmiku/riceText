import type { ForumSessionUser, ForumUser } from "@ricetext/contracts";
import type { Context } from "hono";
import type { WorkerEnv, WorkerVariables } from "./env";
import { WorkerHttpError } from "./http-error";

type AppContext = Context<{ Bindings: WorkerEnv; Variables: WorkerVariables }>;

type UserRow = {
  id: string;
  name: string;
  role: ForumUser["role"];
  is_friend: number;
  bio: string;
};

function userFromRow(row: UserRow): ForumUser {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    isFriend: row.is_friend === 1,
    bio: row.bio,
  };
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const segment of header.split(";")) {
    const [key, ...value] = segment.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function findUser(db: D1Database, id: string): Promise<ForumUser | null> {
  const row = await db
    .prepare("SELECT id, name, role, is_friend, bio FROM users WHERE id = ?")
    .bind(id)
    .first<UserRow>();
  return row ? userFromRow(row) : null;
}

/** 生产只信任 HttpOnly session；x-user-id 仅在显式 demo 环境中生效。 */
export async function optionalPrincipal(context: AppContext): Promise<ForumUser | null> {
  const token = cookieValue(context.req.header("cookie"), "ricetext_session");
  if (token) {
    const tokenHash = await sha256(token);
    const row = await context.env.DB.prepare(
      "SELECT user.id, user.name, user.role, user.is_friend, user.bio " +
        "FROM auth_sessions session " +
        "JOIN users user ON user.id = session.user_id " +
        "WHERE session.token_hash = ? " +
        "AND session.revoked_at IS NULL " +
        "AND session.expires_at > ?",
    )
      .bind(tokenHash, new Date().toISOString())
      .first<UserRow>();
    if (row) return userFromRow(row);
  }

  if (context.env.ALLOW_DEMO_AUTH !== "true") return null;
  const requested = context.req.header("x-user-id");
  if (!requested) return null;
  const userId = requested === "author" || requested === "moderator" ? requested : "reader";
  return findUser(context.env.DB, userId);
}

export async function requirePrincipal(context: AppContext): Promise<ForumUser> {
  const principal = await optionalPrincipal(context);
  if (!principal) throw new WorkerHttpError(401, "AUTH_REQUIRED", "请先登录");
  return principal;
}

/** 编辑权以 owner/ACL 为准，moderator 具有全局权限；不能只按 author 角色放行。 */
export async function canEditDocument(
  context: AppContext,
  documentId: string,
  principal: ForumUser | null,
): Promise<boolean> {
  if (!principal) return false;
  if (principal.role === "moderator") return true;
  if (context.env.ALLOW_DEMO_AUTH === "true" && principal.role === "author") return true;
  const access = await context.env.DB.prepare(
    "SELECT 1 AS allowed FROM documents document " +
      "LEFT JOIN document_acl acl ON acl.document_id = document.id AND acl.user_id = ? " +
      "WHERE document.id = ? AND (document.created_by = ? OR acl.permission IN ('edit', 'admin'))",
  )
    .bind(principal.id, documentId, principal.id)
    .first<{ allowed: number }>();
  return Boolean(access);
}

export async function requireDocumentEditor(
  context: AppContext,
  documentId: string,
): Promise<ForumUser> {
  const principal = await requirePrincipal(context);
  if (!(await canEditDocument(context, documentId, principal))) {
    throw new WorkerHttpError(403, "FORBIDDEN", "当前身份无权修改此文档");
  }
  return principal;
}

export async function sessionUser(
  context: AppContext,
  current: ForumUser,
): Promise<ForumSessionUser> {
  const state = await context.env.DB.prepare(
    "SELECT COALESCE(wallet.balance, 0) AS coins, " +
      "EXISTS(SELECT 1 FROM reply_receipts receipt WHERE receipt.user_id = user.id) AS replied " +
      "FROM users user LEFT JOIN wallets wallet ON wallet.user_id = user.id WHERE user.id = ?",
  )
    .bind(current.id)
    .first<{ coins: number; replied: number }>();
  return {
    ...current,
    avatar: Array.from(current.name)[0] ?? "用",
    coins: Number(state?.coins ?? 0),
    replied: state?.replied === 1,
  };
}

export async function availableUsers(
  context: AppContext,
  current: ForumUser,
): Promise<ForumSessionUser[]> {
  if (context.env.ALLOW_DEMO_AUTH !== "true") {
    return [await sessionUser(context, current)];
  }
  const result = await context.env.DB.prepare(
    "SELECT user.id, user.name, user.role, user.is_friend, user.bio, " +
      "COALESCE(wallet.balance, 0) AS coins, " +
      "EXISTS(SELECT 1 FROM reply_receipts receipt WHERE receipt.user_id = user.id) AS replied " +
      "FROM users user LEFT JOIN wallets wallet ON wallet.user_id = user.id ORDER BY user.id",
  ).all<UserRow & { coins: number; replied: number }>();
  return result.results.map((row) => ({
    ...userFromRow(row),
    avatar: Array.from(row.name)[0] ?? "用",
    coins: Number(row.coins),
    replied: row.replied === 1,
  }));
}
