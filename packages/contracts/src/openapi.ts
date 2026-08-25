import { z } from "zod";
import { contractRoutes } from "./routes.js";

/** OpenAPI 3.1 文档的松散结构类型。 */
export type OpenApiDocument = Record<string, unknown>;

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
          "论坛身份 ID：author、reader 或 moderator；省略时默认 reader。生产接入时替换 AuthProvider。",
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
            route.operationId === "readAsset" && status === "200"
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
    pathItem[route.method.toLowerCase()] = {
      operationId: route.operationId,
      tags: route.tags,
      summary: route.summary,
      description: `${route.description}\n\n权限与失败状态均列于 responses；请求示例可使用 x-user-id: reader。`,
      parameters,
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
  return {
    openapi: "3.1.0",
    info: {
      title: "RiceText 论坛与小说富文本 API",
      version: "0.1.0",
      description:
        "文档、章节、用户互动、附件权益和投票均使用共享契约，并由 SQLite 服务持久化实现。",
    },
    servers: [{ url: "http://localhost:8787", description: "本地开发 API" }],
    tags: [
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
