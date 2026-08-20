import type { FastifyReply } from "fastify";
import type { JsonValue } from "@ricetext/contracts";

/** 路由可抛出的稳定 HTTP 业务错误。 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, JsonValue> | undefined;

  /** 创建业务错误。 */
  constructor(status: number, code: string, message: string, details?: Record<string, JsonValue>) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** 发送与共享 ApiErrorSchema 一致的错误体。 */
export function sendHttpError(reply: FastifyReply, error: HttpError): FastifyReply {
  return reply.status(error.status).send({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });
}
