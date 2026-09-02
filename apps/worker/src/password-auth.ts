import type { PasswordLoginRequest } from "@ricetext/contracts";
import type { WorkerEnv } from "./env";
import { WorkerHttpError } from "./http-error";

type CredentialRow = {
  user_id: string;
  salt: string;
  password_hash: string;
  iterations: number;
  locked_until: string | null;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

/** 使用 Web Crypto 原生 PBKDF2；迭代次数随凭据保存，便于以后逐步升级强度。 */
export async function derivePasswordHash(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt).buffer, iterations },
    key,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

function equalHash(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

async function tokenHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sessionToken(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/** 校验本地凭据并建立与 OIDC 共用的服务端会话；失败计数使用原子 UPDATE 防止并发绕过。 */
export async function passwordLogin(
  request: PasswordLoginRequest,
  env: WorkerEnv,
): Promise<Response> {
  const now = new Date();
  const row = await env.DB.prepare(
    "SELECT user_id, salt, password_hash, iterations, locked_until " +
      "FROM password_credentials WHERE username = ? COLLATE NOCASE",
  )
    .bind(request.username)
    .first<CredentialRow>();
  if (row?.locked_until && row.locked_until > now.toISOString()) {
    throw new WorkerHttpError(429, "AUTH_LOCKED", "登录失败次数过多，请稍后再试");
  }

  // 未知账号也执行同等成本的派生，避免通过响应时间枚举有效用户名。
  const candidateHash = await derivePasswordHash(
    request.password,
    row ? base64UrlToBytes(row.salt) : new Uint8Array(16),
    row?.iterations ?? 100_000,
  );
  const valid = equalHash(
    candidateHash,
    row?.password_hash ?? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  );
  if (!row || !valid) {
    if (row) {
      const lockedUntil = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      await env.DB.prepare(
        "UPDATE password_credentials SET " +
          "failed_attempts = failed_attempts + 1, " +
          "locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN ? ELSE NULL END, " +
          "updated_at = ? WHERE user_id = ?",
      )
        .bind(lockedUntil, now.toISOString(), row.user_id)
        .run();
    }
    throw new WorkerHttpError(401, "AUTH_INVALID_CREDENTIALS", "账号或密码错误");
  }

  const token = sessionToken();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE password_credentials SET failed_attempts = 0, locked_until = NULL, updated_at = ? " +
        "WHERE user_id = ?",
    ).bind(now.toISOString(), row.user_id),
    env.DB.prepare(
      "INSERT INTO auth_sessions(token_hash, user_id, expires_at, created_at, last_seen_at, revoked_at) " +
        "VALUES (?, ?, ?, ?, ?, NULL)",
    ).bind(
      await tokenHash(token),
      row.user_id,
      expiresAt.toISOString(),
      now.toISOString(),
      now.toISOString(),
    ),
  ]);
  const secure = env.ENVIRONMENT === "development" ? "" : " Secure;";
  return new Response(null, {
    status: 204,
    headers: {
      "set-cookie":
        "ricetext_session=" + encodeURIComponent(token) +
        "; HttpOnly;" + secure + " SameSite=Strict; Path=/; Max-Age=604800",
      "cache-control": "no-store",
    },
  });
}
