import { z } from "zod";
import { contractRoutes } from "./routes.js";
import { ApiErrorSchema, PasswordLoginRequestSchema } from "./schemas.js";

/** OpenAPI 3.1 文档的松散结构类型。 */
export type OpenApiDocument = Record<string, unknown>;

const PUBLIC_OPERATIONS = new Set([
  "getDocument",
  "listRevisions",
  "getRevision",
  "readAsset",
  "getDiceRoll",
  "listChapters",
]);

/**
 * 把 Zod JSON Schema 转成可独立分发的结构。
 * 递归 Tiptap 节点的 `$ref` 不跨文件保留，避免消费者缺少 `$defs` 时得到失效文档。
 */
function portableSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const input = value as Record<string, unknown>;
    if (typeof input.$ref === "string") {
      return {
        type: "object",
        description:
          "递归节点，完整结构由 @ricetext/contracts 的 Zod 契约校验。",
        additionalProperties: true,
      };
    }
    return Object.fromEntries(
      Object.entries(input)
        .filter(([key]) => key !== "$schema" && key !== "$defs")
        .map(([key, item]) => [key, visit(item)]),
    );
  };
  return visit(raw) as Record<string, unknown>;
}

/** 将对象 schema 的字段展开为 OpenAPI path/query parameters。 */
function parametersFrom(
  schema: z.ZodType | undefined,
  location: "path" | "query",
): unknown[] {
  if (!schema) return [];
  const json = portableSchema(schema);
  const properties = (json.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const required = new Set(
    Array.isArray(json.required) ? (json.required as string[]) : [],
  );
  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: location,
      // 带 default 的查询参数可以省略，由服务端 schema 负责补默认值。
      required:
      location === "path" || (required.has(name) && !("default" in property)),
    description:
      property.description ??
      `${location === "path" ? "路径" : "查询"}参数 ${name}`,
    schema: property,
    example:
      name === "documentId" ? "demo-post" : name === "limit" ? 20 : undefined,
  }));
}

/** 从 route contract 单一来源生成 OpenAPI 3.1 文档。 */
export function buildOpenApiDocument(): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of contractRoutes) {
    const openapiPath = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    const pathItem = paths[openapiPath] ?? {};
    const parameters = [
      ...parametersFrom(route.params, "path"),
      ...parametersFrom(route.query, "query"),
      {
        name: "x-user-id",
        in: "header",
        required: false,
        description:
          "仅限本地 demo：论坛身份 ID author、reader 或 moderator。preview/production 会忽略该请求头。",
        schema: {
          type: "string",
          enum: ["author", "reader", "moderator"],
          default: "reader",
        },
        example: "reader",
      },
    ];
    const responses = Object.fromEntries(
      Object.entries(route.responses).map(([status, response]) => [
        status,
        {
          description: response.description,
          content:
            route.operationId === "readAsset" && (status === "200" || status === "206")
              ? { "image/*": { schema: { type: "string", format: "binary" } } }
              : {
                  "application/json": {
                    schema: portableSchema(response.schema),
                    ...(Number(status) >= 400
                      ? {
                          example: {
                            error: {
                              code: "EXAMPLE_ERROR",
                              message: response.description,
                            },
                          },
                        }
                      : {}),
                  },
                },
        },
      ]),
    );
    if (!PUBLIC_OPERATIONS.has(route.operationId) && !responses["401"]) {
      responses["401"] = {
        description: "未登录或会话已过期。",
        content: { "application/json": { schema: portableSchema(ApiErrorSchema) } },
      };
    }
    pathItem[route.method.toLowerCase()] = {
      operationId: route.operationId,
      tags: route.tags,
      summary: route.summary,
      description: `${route.description}\n\n生产使用 HttpOnly session cookie；x-user-id 仅供显式启用的本地 demo 模式。`,
      parameters,
      security: PUBLIC_OPERATIONS.has(route.operationId)
        ? [{}, { cookieSession: [] }]
        : [{ cookieSession: [] }],
      ...(route.operationId === "uploadAsset"
        ? {
            requestBody: {
              required: true,
              description: "file 为待上传图片二进制。",
              content: {
                "multipart/form-data": {
                  schema: {
                    type: "object",
                    required: ["file"],
                    properties: {
                      file: {
                        type: "string",
                        format: "binary",
                        description: "PNG/JPEG/GIF/WebP，最大 8 MiB",
                      },
                    },
                  },
                },
              },
            },
          }
        : route.body
          ? {
              requestBody: {
                required: true,
                description: "请求字段由共享 Zod 契约校验。",
                content: {
                  "application/json": { schema: portableSchema(route.body) },
                },
              },
            }
          : {}),
      responses,
      ...(route.implementationStatus
        ? { "x-implementation-status": route.implementationStatus }
        : {}),
    };
    paths[openapiPath] = pathItem;
  }
  paths["/api/auth/password/login"] = {
    post: {
      operationId: "passwordLogin",
      tags: ["认证"],
      summary: "使用本地账号密码登录",
      requestBody: {
        required: true,
        content: { "application/json": { schema: portableSchema(PasswordLoginRequestSchema) } },
      },
      responses: {
        "204": { description: "登录成功并写入安全 session cookie。" },
        "401": { description: "账号或密码错误。" },
        "429": { description: "同一来源的登录尝试过于频繁。" },
        "503": { description: "旧凭据参数不受生产 Worker 支持，需要管理员重设密码。" },
      },
    },
  };
  paths["/api/auth/login"] = {
    get: {
      operationId: "beginOidcLogin",
      tags: ["认证"],
      summary: "开始 OIDC 登录",
      parameters: [{ name: "returnTo", in: "query", required: false, schema: { type: "string" } }],
      responses: { "302": { description: "跳转到 OIDC provider。" }, "503": { description: "OIDC 尚未配置。" } },
    },
  };
  paths["/api/auth/callback"] = {
    get: {
      operationId: "finishOidcLogin",
      tags: ["认证"],
      summary: "完成 OIDC 登录",
      responses: { "302": { description: "写入安全 session cookie 后返回应用。" }, "401": { description: "state、nonce、授权码或 ID token 无效。" } },
    },
  };
  paths["/api/auth/logout"] = {
    post: {
      operationId: "logout",
      tags: ["认证"],
      summary: "注销当前会话",
      security: [{ cookieSession: [] }],
      responses: { "204": { description: "会话已删除并清除 cookie。" } },
    },
  };
  paths["/api/health"] = {
    get: {
      operationId: "workerHealth",
      tags: ["认证"],
      summary: "Worker 健康检查",
      responses: { "200": { description: "Worker 正常响应。" } },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "RiceText 论坛与小说富文本 API",
      version: "0.1.0",
      description:
        "文档、章节、用户互动、附件权益和投票均使用共享契约，并由 SQLite 服务持久化实现。",
    },
    servers: [{ url: "http://localhost:8787", description: "本地开发 API" }],
    components: {
      securitySchemes: {
        cookieSession: {
          type: "apiKey",
          in: "cookie",
          name: "ricetext_session",
          description: "OIDC 登录后由 Worker 设置的 HttpOnly session cookie。",
        },
      },
    },
    tags: [
      { name: "认证", description: "OIDC 登录、会话和 Worker 健康状态。" },
      { name: "文档", description: "文档当前态、不可变修订和乐观并发。" },
      { name: "图片", description: "本地白名单图片上传和读取。" },
      { name: "骰子", description: "初始化后稳定、可显式重投的跑团骰子。" },
      { name: "间贴", description: "段落首尾锚点上的树状回复和赞踩。" },
      {
        name: "论坛业务",
        description: "论坛创作、用户互动、附件权益和投票能力。",
      },
    ],
    paths,
  };
}
