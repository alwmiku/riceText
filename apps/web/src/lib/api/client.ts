import { ApiClientError, createApiClient } from "@ricetext/contracts";

// 契约路径已包含 /api；此根地址仅用于独立部署的 API。
const API_ROOT = (import.meta.env.VITE_API_ROOT ?? "").replace(/\/$/, "");
export function isDemoAuthHeaderEnabled(): boolean {
  const configured = import.meta.env.VITE_DEMO_AUTH;
  return configured === undefined ? import.meta.env.DEV : configured === "true";
}

/** 将前端显示身份映射为 AuthProvider 接受的论坛身份。 */
function getForumUserHeader(): "author" | "reader" | "moderator" {
  const identity = localStorage.getItem("ricetext:identity");
  if (identity === "user_reader" || identity === "reader") return "reader";
  if (identity === "user_moderator" || identity === "moderator")
    return "moderator";
  return "author";
}

/** Pages 和 Worker 使用不同预览源时，解析 API 所属资源的相对地址。 */
export function resolveApiUrl(url: string | null): string | null {
  if (!url || !API_ROOT || /^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return new URL(url, API_ROOT + "/").toString();
}

/** 保留 HTTP 状态和原始响应正文，便于调用方区分冲突。 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
    readonly code = "UNKNOWN_ERROR",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** 每次请求都解析当前身份，让同一客户端工厂支持身份切换。 */
export const api = () =>
  createApiClient({
    baseUrl: API_ROOT,
    ...(isDemoAuthHeaderEnabled() ? { userId: getForumUserHeader } : {}),
  });

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

/** 仅将传输失败和代理返回的 502/503 响应视为服务不可用。 */
export function isServiceUnavailable(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return false;
  }
  if (error instanceof ApiClientError) {
    return error.status === 502 || error.status === 503;
  }
  return true;
}

/** 将共享客户端的类型化错误转换为 Web 宿主公开的 ApiError。 */
export function rethrowClientError(error: unknown): never {
  if (error instanceof ApiClientError) {
    throw new ApiError(error.message, error.status, error.details, error.code);
  }
  throw error;
}
