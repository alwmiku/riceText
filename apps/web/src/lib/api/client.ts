import { ApiClientError, createApiClient } from "@ricetext/contracts";

// Contract paths already include /api; this root is only for a separately hosted API.
const API_ROOT = (import.meta.env.VITE_API_ROOT ?? "").replace(/\/$/, "");
export function isDemoAuthHeaderEnabled(): boolean {
  const configured = import.meta.env.VITE_DEMO_AUTH;
  return configured === undefined ? import.meta.env.DEV : configured === "true";
}

/** Map the displayed frontend identity to the forum identity accepted by AuthProvider. */
function getForumUserHeader(): "author" | "reader" | "moderator" {
  const identity = localStorage.getItem("ricetext:identity");
  if (identity === "user_reader" || identity === "reader") return "reader";
  if (identity === "user_moderator" || identity === "moderator")
    return "moderator";
  return "author";
}

/** Resolve API-owned relative resources when Pages and Worker use different preview origins. */
export function resolveApiUrl(url: string | null): string | null {
  if (!url || !API_ROOT || /^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return new URL(url, API_ROOT + "/").toString();
}

/** Preserve HTTP status and the original body so callers can distinguish conflicts. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Resolve identity for every request so one client factory covers identity changes. */
export const api = () =>
  createApiClient({
    baseUrl: API_ROOT,
    ...(isDemoAuthHeaderEnabled() ? { userId: getForumUserHeader } : {}),
  });

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

/** Only transport failures and proxy 502/503 responses count as unavailable. */
export function isServiceUnavailable(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return false;
  }
  if (error instanceof ApiClientError) {
    return error.status === 502 || error.status === 503;
  }
  return true;
}

/** Convert the shared client's typed error to the Web host's public ApiError. */
export function rethrowClientError(error: unknown): never {
  if (error instanceof ApiClientError) {
    throw new ApiError(error.message, error.status, error.details);
  }
  throw error;
}
