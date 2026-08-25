import type { FastifyRequest } from "fastify";
import { getFastifySchema as getContractFastifySchema } from "@ricetext/contracts";
import type { RequestIdentity } from "../auth.js";
import { HttpError } from "../errors.js";
import type { RouteDependencies } from "./dependencies.js";

/** 把 Fastify 的 unknown params 收窄为路由声明中的字符串参数。 */
export function params(request: FastifyRequest): Record<string, string> {
  return request.params as Record<string, string>;
}

/** 把 unknown query 收窄为共享 Zod schema 可以解析的键值结构。 */
export function query(
  request: FastifyRequest,
): Record<string, string | number | boolean | undefined> {
  return request.query as Record<string, string | number | boolean | undefined>;
}

/**
 * 复用契约生成的 route schema。querystring 仍由路由显式 Zod parse，避免
 * Ajv 与 Zod 对 default/coerce 的解释差异导致运行时和 OpenAPI 漂移。
 */
export function getFastifySchema(operationId: string): Record<string, unknown> {
  const { querystring: _querystring, ...schema } =
    getContractFastifySchema(operationId);
  return schema;
}

/** 使用应用注入的 AuthProvider 解析当前请求身份。 */
export function identity(
  dependencies: RouteDependencies,
  request: FastifyRequest,
): RequestIdentity {
  return dependencies.auth.resolve(request);
}

/** 文档和章节写入只允许作者或版主。 */
export function requireEditor(
  dependencies: RouteDependencies,
  request: FastifyRequest,
): RequestIdentity {
  const user = identity(dependencies, request);
  if (user.role === "reader") {
    throw new HttpError(403, "FORBIDDEN", "只有作者或版主可以修改文档");
  }
  return user;
}
