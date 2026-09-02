import type { JsonValue } from "@ricetext/contracts";

/** 与运行时无关的业务错误，由 Fastify 和 Worker 适配为同一 HTTP 错误结构。 */
export class DomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, JsonValue>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
