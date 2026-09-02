// 生产登录依赖 Worker 设置的 HttpOnly cookie，前端只负责跳转和携带 credentials。
import type { ForumSession } from "@ricetext/contracts";
import { api, resolveApiUrl } from "./client";

export function getForumSession(signal?: AbortSignal): Promise<ForumSession> {
  return api().getForumSession(signal);
}

export function beginForumLogin(returnTo = window.location.href): void {
  const path = "/api/auth/login?returnTo=" + encodeURIComponent(returnTo);
  window.location.assign(resolveApiUrl(path) ?? path);
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
