import type { JsonValue } from "@ricetext/contracts";

/** Worker 与各 D1 仓储共用的稳定错误边界，确保 HTTP 状态和业务错误码不会漂移。 */
export class WorkerHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, JsonValue>,
  ) {
    super(message);
    this.name = "WorkerHttpError";
  }
}
