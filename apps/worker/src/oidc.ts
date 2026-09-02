import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { WorkerEnv } from "./env";
import { WorkerHttpError } from "./http-error";

type OidcConfiguration = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

type LoginStateRow = {
  code_verifier: string;
  nonce: string;
  return_to: string;
  expires_at: string;
};

const oidcConfigurations = new Map<string, Promise<OidcConfiguration>>();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  let encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_");
  while (encoded.endsWith("=")) encoded = encoded.slice(0, -1);
  return encoded;
}

function randomToken(size = 32): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

async function tokenHash(value: string): Promise<string> {
  return Array.from(await sha256(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function setCookie(name: string, value: string, attributes: string): string {
  return name + "=" + encodeURIComponent(value) + "; " + attributes;
}

function requiredConfig(env: WorkerEnv): {
  issuer: string;
  clientId: string;
  clientSecret: string;
} {
  if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET) {
    throw new WorkerHttpError(503, "OIDC_NOT_CONFIGURED", "OIDC 登录尚未配置");
  }
  return {
    issuer: env.OIDC_ISSUER.endsWith("/") ? env.OIDC_ISSUER.slice(0, -1) : env.OIDC_ISSUER,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
  };
}

async function configuration(issuer: string): Promise<OidcConfiguration> {
  let pending = oidcConfigurations.get(issuer);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(issuer + "/.well-known/openid-configuration");
      if (!response.ok) {
        throw new WorkerHttpError(502, "OIDC_DISCOVERY_FAILED", "无法读取 OIDC 配置");
      }
      const value = (await response.json()) as Partial<OidcConfiguration>;
      if (
        value.issuer !== issuer ||
        !value.authorization_endpoint ||
        !value.token_endpoint ||
        !value.jwks_uri
      ) {
        throw new WorkerHttpError(502, "OIDC_DISCOVERY_INVALID", "OIDC 配置不完整");
      }
      return value as OidcConfiguration;
    })();
    oidcConfigurations.set(issuer, pending);
    pending.catch(() => oidcConfigurations.delete(issuer));
  }
  return pending;
}

function allowedReturnTo(request: Request, env: WorkerEnv): string {
  const requestUrl = new URL(request.url);
  const requested = requestUrl.searchParams.get("returnTo");
  if (!requested) return new URL("/", request.url).toString();
  if (requested.startsWith("/") && !requested.startsWith("//")) {
    return new URL(requested, request.url).toString();
  }
  let url: URL;
  try {
    url = new URL(requested);
  } catch {
    throw new WorkerHttpError(422, "INVALID_RETURN_TO", "登录返回地址无效");
  }
  const allowed = new Set(
    env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  );
  if (!allowed.has(url.origin)) {
    throw new WorkerHttpError(422, "INVALID_RETURN_TO", "登录返回地址不在允许列表中");
  }
  return url.toString();
}

function claimName(payload: JWTPayload): string {
  const candidate = [payload.preferred_username, payload.name, payload.email].find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  return typeof candidate === "string" ? candidate.trim().slice(0, 80) : "新读者";
}

async function resolveOrCreateUser(
  env: WorkerEnv,
  issuer: string,
  payload: JWTPayload,
): Promise<string> {
  const subject = payload.sub;
  if (!subject) throw new WorkerHttpError(401, "OIDC_SUBJECT_MISSING", "OIDC 身份缺少 subject");
  const existing = await env.DB.prepare(
    "SELECT user_id FROM auth_identities WHERE issuer = ? AND subject = ?",
  )
    .bind(issuer, subject)
    .first<{ user_id: string }>();
  if (existing) return existing.user_id;

  const digest = await tokenHash(issuer + "|" + subject);
  const userId = "oidc_" + digest.slice(0, 32);
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO users(" +
          "id, name, role, is_friend, bio, created_at, updated_at" +
          ") VALUES (?, ?, 'reader', 0, '', ?, ?)",
      ).bind(userId, claimName(payload), now, now),
      env.DB.prepare(
        "INSERT INTO auth_identities(issuer, subject, user_id, created_at) VALUES (?, ?, ?, ?)",
      ).bind(issuer, subject, userId, now),
      env.DB.prepare("INSERT OR IGNORE INTO wallets(user_id, balance) VALUES (?, 0)").bind(userId),
    ]);
    return userId;
  } catch (error) {
    const concurrent = await env.DB.prepare(
      "SELECT user_id FROM auth_identities WHERE issuer = ? AND subject = ?",
    )
      .bind(issuer, subject)
      .first<{ user_id: string }>();
    if (concurrent) return concurrent.user_id;
    throw error;
  }
}

/** 创建一次性 state、nonce 与 PKCE verifier，回调前不建立任何用户会话。 */
export async function beginOidcLogin(request: Request, env: WorkerEnv): Promise<Response> {
  const auth = requiredConfig(env);
  const oidc = await configuration(auth.issuer);
  const state = randomToken();
  const verifier = randomToken(48);
  const nonce = randomToken();
  const challenge = bytesToBase64Url(await sha256(verifier));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO auth_login_states(" +
      "state_hash, code_verifier, nonce, return_to, expires_at, created_at" +
      ") VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      await tokenHash(state),
      verifier,
      nonce,
      allowedReturnTo(request, env),
      expiresAt,
      now.toISOString(),
    )
    .run();

  const redirectUri = new URL("/api/auth/callback", request.url).toString();
  const target = new URL(oidc.authorization_endpoint);
  target.searchParams.set("response_type", "code");
  target.searchParams.set("client_id", auth.clientId);
  target.searchParams.set("redirect_uri", redirectUri);
  target.searchParams.set("scope", "openid profile email");
  target.searchParams.set("state", state);
  target.searchParams.set("nonce", nonce);
  target.searchParams.set("code_challenge", challenge);
  target.searchParams.set("code_challenge_method", "S256");
  return new Response(null, {
    status: 302,
    headers: {
      location: target.toString(),
      "set-cookie": setCookie(
        "ricetext_oidc_state",
        state,
        "HttpOnly; Secure; SameSite=Lax; Path=/api/auth/callback; Max-Age=600",
      ),
      "cache-control": "no-store",
    },
  });
}

/** 原子消费登录 state，校验 ID Token 后才写入哈希化会话令牌。 */
export async function finishOidcLogin(request: Request, env: WorkerEnv): Promise<Response> {
  const auth = requiredConfig(env);
  const requestUrl = new URL(request.url);
  const state = requestUrl.searchParams.get("state");
  const code = requestUrl.searchParams.get("code");
  const stateCookie = cookie(request, "ricetext_oidc_state");
  if (!state || !code || !stateCookie || state !== stateCookie) {
    throw new WorkerHttpError(401, "OIDC_STATE_INVALID", "OIDC 登录状态无效");
  }
  const login = await env.DB.prepare(
    "DELETE FROM auth_login_states WHERE state_hash = ? RETURNING " +
      "code_verifier, nonce, return_to, expires_at",
  )
    .bind(await tokenHash(state))
    .first<LoginStateRow>();
  if (!login || login.expires_at <= new Date().toISOString()) {
    throw new WorkerHttpError(401, "OIDC_STATE_EXPIRED", "OIDC 登录状态已过期");
  }

  const oidc = await configuration(auth.issuer);
  const redirectUri = new URL("/api/auth/callback", request.url).toString();
  const tokenResponse = await fetch(oidc.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: auth.clientId,
      client_secret: auth.clientSecret,
      code_verifier: login.code_verifier,
    }),
  });
  if (!tokenResponse.ok) {
    throw new WorkerHttpError(401, "OIDC_TOKEN_EXCHANGE_FAILED", "OIDC 授权码交换失败");
  }
  const tokens = (await tokenResponse.json()) as { id_token?: unknown };
  if (typeof tokens.id_token !== "string") {
    throw new WorkerHttpError(401, "OIDC_ID_TOKEN_MISSING", "OIDC 响应缺少 ID Token");
  }
  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(
      tokens.id_token,
      createRemoteJWKSet(new URL(oidc.jwks_uri)),
      { issuer: auth.issuer, audience: auth.clientId },
    );
    payload = verified.payload;
  } catch {
    throw new WorkerHttpError(401, "OIDC_ID_TOKEN_INVALID", "OIDC ID Token 校验失败");
  }
  if (payload.nonce !== login.nonce) {
    throw new WorkerHttpError(401, "OIDC_NONCE_INVALID", "OIDC nonce 校验失败");
  }
  const userId = await resolveOrCreateUser(env, auth.issuer, payload);
  const sessionToken = randomToken(48);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  await env.DB.prepare(
    "INSERT INTO auth_sessions(" +
      "token_hash, user_id, expires_at, created_at, last_seen_at, revoked_at" +
      ") VALUES (?, ?, ?, ?, ?, NULL)",
  )
    .bind(
      await tokenHash(sessionToken),
      userId,
      expiresAt.toISOString(),
      now.toISOString(),
      now.toISOString(),
    )
    .run();
  const headers = new Headers({ location: login.return_to, "cache-control": "no-store" });
  headers.append(
    "set-cookie",
    setCookie(
      "ricetext_session",
      sessionToken,
      "HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800",
    ),
  );
  headers.append(
    "set-cookie",
    setCookie(
      "ricetext_oidc_state",
      "",
      "HttpOnly; Secure; SameSite=Lax; Path=/api/auth/callback; Max-Age=0",
    ),
  );
  return new Response(null, { status: 302, headers });
}

export async function logout(request: Request, env: WorkerEnv): Promise<Response> {
  const session = cookie(request, "ricetext_session");
  if (session) {
    await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
      .bind(await tokenHash(session))
      .run();
  }
  return new Response(null, {
    status: 204,
    headers: {
      "set-cookie": setCookie(
        "ricetext_session",
        "",
        "HttpOnly;" +
        (env.ENVIRONMENT === "development" ? "" : " Secure;") +
        " SameSite=Lax; Path=/; Max-Age=0",
      ),
      "cache-control": "no-store",
    },
  });
}

/** 定时删除过期登录 state 与会话，避免认证表无限增长。 */
export async function cleanupExpiredAuth(
  db: D1Database,
  now = new Date().toISOString(),
): Promise<number> {
  const results = await db.batch([
    db.prepare("DELETE FROM auth_login_states WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL").bind(now),
  ]);
  return results.reduce((total, result) => total + result.meta.changes, 0);
}
