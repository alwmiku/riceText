// 生产登录依赖 Worker 设置的 HttpOnly cookie，前端只负责跳转和携带 credentials。
import type { ForumSession } from "@ricetext/contracts";
import { api, resolveApiUrl } from "./client";

export function getForumSession(signal?: AbortSignal): Promise<ForumSession> {
  return api().getForumSession(signal);
}

export async function loginForumSession(username: string, password: string): Promise<void> {
  const path = resolveApiUrl("/api/auth/password/login") ?? "/api/auth/password/login";
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(payload?.error?.message ?? "登录失败");
  }
}

export async function logoutForumSession(): Promise<void> {
  const path = resolveApiUrl("/api/auth/logout") ?? "/api/auth/logout";
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!response.ok && response.status !== 401) {
    throw new Error("退出登录失败");
  }
}
