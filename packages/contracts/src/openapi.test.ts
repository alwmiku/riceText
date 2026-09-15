import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "./openapi.js";
import { contractRoutes, getContractRoute } from "./routes.js";

describe("契约路由 helpers", () => {
  it("按 operationId 返回已知路由契约", () => {
    expect(getContractRoute("getDocument")).toMatchObject({
      method: "GET",
      path: "/api/documents/:documentId",
    });
    expect(getContractRoute("listRevisions").query).toBeDefined();
    expect(getContractRoute("submitPollVote").body).toBeDefined();
    expect(getContractRoute("updateDocumentChapter")).toMatchObject({
      method: "PATCH",
      implementationStatus: "implemented",
    });
  });

  it("拒绝未知 operationId", () => {
    expect(() => getContractRoute("missing-operation")).toThrow(
      "未知契约 operationId: missing-operation",
    );
  });
});

describe("buildOpenApiDocument", () => {
  it("从全部契约生成带说明、参数和请求响应内容的 OpenAPI 3.1", () => {
    const document = buildOpenApiDocument() as {
      openapi: string;
      info: { title: string; description: string };
      servers: Array<{ url: string }>;
      tags: Array<{ name: string }>;
      components: { securitySchemes: Record<string, Record<string, unknown>> };
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };

    expect(document.openapi).toBe("3.1.0");
    expect(document.info.title).toContain("RiceText");
    expect(document.info.description).toContain("由 Cloudflare Worker 与 D1 持久化实现");
    expect(document.servers).toEqual([
      { url: "http://localhost:8787", description: "本地开发 API" },
    ]);
    expect(document.tags.map((tag) => tag.name)).toEqual([
      "认证",
      "文档",
      "图片",
      "骰子",
      "间贴",
      "论坛业务",
    ]);
    expect(
      Object.values(document.paths).flatMap((path) => Object.keys(path)),
    ).toHaveLength(contractRoutes.length + 5);

    const getDocument = document.paths["/api/documents/{documentId}"]!.get!;
    expect(getDocument.operationId).toBe("getDocument");
    expect(getDocument.description).toContain("HttpOnly session cookie");
    expect(getDocument.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "documentId",
          in: "path",
          required: true,
          example: "demo-post",
        }),
        expect.objectContaining({
          name: "x-user-id",
          in: "header",
          required: false,
          example: "reader",
        }),
      ]),
    );

    const revisions =
      document.paths["/api/documents/{documentId}/revisions"]!.get!;
    expect(revisions.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "cursor",
          in: "query",
          required: false,
        }),
        expect.objectContaining({
          name: "limit",
          in: "query",
          required: false,
          example: 20,
        }),
      ]),
    );

    const update = document.paths["/api/documents/{documentId}"]!.put! as {
      requestBody: {
        content: Record<string, { schema: Record<string, unknown> }>;
      };
      responses: Record<
        string,
        { content: Record<string, { example?: unknown }> }
      >;
    };
    expect(
      update.requestBody.content["application/json"]?.schema,
    ).toMatchObject({ type: "object" });
    expect(
      update.responses["409"]?.content["application/json"]?.example,
    ).toEqual({
      error: { code: "EXAMPLE_ERROR", message: expect.any(String) },
    });

    const upload = document.paths["/api/assets"]!.post! as {
      requestBody: {
        content: Record<
          string,
          {
            schema: { required: string[]; properties: Record<string, unknown> };
          }
        >;
      };
    };
    expect(
      upload.requestBody.content["multipart/form-data"]?.schema.required,
    ).toEqual(["file"]);
    expect(
      upload.requestBody.content["multipart/form-data"]?.schema.properties.file,
    ).toMatchObject({ format: "binary" });

    const readAsset = document.paths["/api/assets/{assetId}"]!.get! as {
      responses: Record<
        string,
        { content: Record<string, { schema: unknown }> }
      >;
    };
    expect(readAsset.responses["200"]?.content["image/*"]?.schema).toEqual({
      type: "string",
      format: "binary",
    });

    expect(document.paths["/api/auth/password/login"]?.post?.operationId).toBe("passwordLogin");
    expect(document.paths["/api/auth/login"]?.get?.operationId).toBe("beginOidcLogin");
    expect(document.components.securitySchemes.cookieSession).toMatchObject({
      in: "cookie",
      name: "ricetext_session",
    });

    const forumPoll = document.paths["/api/forum/polls/{pollId}"]!.get!;
    expect(forumPoll["x-implementation-status"]).toBe("implemented");
    expect(JSON.stringify(document)).not.toMatch(/"\$(?:schema|defs|ref)"/);
  });
});
