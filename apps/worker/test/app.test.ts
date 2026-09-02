// 在 workerd 中覆盖 D1/R2/OIDC 与并发事务，比普通 Node mock 更接近生产 Worker。
import { createExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { contractRoutes } from "@ricetext/contracts";
import { diffDocuments } from "@ricetext/document-core";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { http, HttpResponse } from "msw";
import {
  cleanupStaleAssets,
  D1AssetRepository,
} from "../src/repositories/asset-repository";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { createWorkerApp } from "../src/app";
import { derivePasswordHash } from "../src/password-auth";
import type { WorkerEnv } from "../src/env";
import { network } from "./network";

const now = "2026-08-20T08:00:00.000Z";
const content = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { textAlign: "left" },
      content: [{ type: "text", text: "Worker 中的雾港来信" }],
    },
  ],
};

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM suggestion_review_guards"),
    env.DB.prepare("DELETE FROM suggestion_batches"),
    env.DB.prepare("DELETE FROM suggestions"),
    env.DB.prepare("DELETE FROM document_mutations"),
    env.DB.prepare("DELETE FROM chapters"),
    env.DB.prepare("DELETE FROM comment_votes"),
    env.DB.prepare("DELETE FROM comment_replies"),
    env.DB.prepare("DELETE FROM reply_receipts"),
    env.DB.prepare("DELETE FROM reply_gates"),
    env.DB.prepare("DELETE FROM comment_threads"),
    env.DB.prepare("DELETE FROM document_revisions"),
    env.DB.prepare("DELETE FROM document_acl"),
    env.DB.prepare("DELETE FROM documents"),
    env.DB.prepare("DELETE FROM auth_login_states"),
    env.DB.prepare("DELETE FROM auth_sessions"),
    env.DB.prepare("DELETE FROM auth_identities"),
    env.DB.prepare("DELETE FROM dice_rolls"),
    env.DB.prepare("DELETE FROM poll_vote_options"),
    env.DB.prepare("DELETE FROM poll_votes"),
    env.DB.prepare("DELETE FROM poll_options"),
    env.DB.prepare("DELETE FROM polls"),
    env.DB.prepare("DELETE FROM attachment_purchases"),
    env.DB.prepare("DELETE FROM attachments"),
    env.DB.prepare("DELETE FROM assets"),
    env.DB.prepare("DELETE FROM wallets"),
    env.DB.prepare("DELETE FROM users"),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO users(id, name, role, is_friend, bio, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind("author", "林见", "author", 1, "作者", now, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO users(id, name, role, is_friend, bio, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind("reader", "小满", "reader", 1, "读者", now, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO documents(id, title, schema_version, current_revision, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind("demo-post", "雾港来信", 1, 1, "author", now, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO document_revisions(document_id, revision, schema_version, content_json, steps_json, author_id, operation, target_revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind("demo-post", 1, 1, JSON.stringify(content), null, "author", "seed", null, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO chapters(id, title, sort_order, document_id, revision, content_json, content_hash, updated_at, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind("chapter-0", "楔子 · 雨季之前", 0, "demo-post", 1, JSON.stringify(content), "hash", now, 0),
  ]);
});

describe("RiceText Worker", () => {
  it("registers every shared contract route", () => {
    const registered = new Set(
      createWorkerApp().routes.map((route) => route.method + " " + route.path),
    );
    for (const route of contractRoutes) {
      expect(registered.has(route.method + " " + route.path)).toBe(true);
    }
  });

  it("applies the D1 baseline and exposes health", async () => {
    const table = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'document_revisions'",
    ).first<{ name: string }>();
    expect(table?.name).toBe("document_revisions");

    const response = await exports.default.fetch("http://example.com/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "ricetext-worker",
    });
  });

  it("reads document, revision history and chapters from D1", async () => {
    const documentResponse = await exports.default.fetch(
      "http://example.com/api/documents/demo-post",
    );
    expect(documentResponse.status).toBe(200);
    await expect(documentResponse.json()).resolves.toMatchObject({
      id: "demo-post",
      revision: 1,
      content: { type: "doc" },
    });

    const revisionResponse = await exports.default.fetch(
      "http://example.com/api/documents/demo-post/revisions?limit=10",
    );
    expect(revisionResponse.status).toBe(200);
    await expect(revisionResponse.json()).resolves.toMatchObject({
      items: [{ revision: 1, operation: "seed" }],
      pageInfo: { nextCursor: null },
    });

    const chapterResponse = await exports.default.fetch(
      "http://example.com/api/forum/chapters",
    );
    expect(chapterResponse.status).toBe(200);
    await expect(chapterResponse.json()).resolves.toMatchObject({
      items: [{ id: "chapter-0", hidden: false }],
    });
  });

  it("allows demo identity headers only when explicitly enabled", async () => {
    const anonymous = await exports.default.fetch("http://example.com/api/forum/session");
    expect(anonymous.status).toBe(401);

    const response = await exports.default.fetch(
      new Request("http://example.com/api/forum/session", {
        headers: { "x-user-id": "author" },
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      current: { id: "author", role: "author" },
    });
    const preflight = await exports.default.fetch(
      new Request("http://example.com/api/documents/demo-post", {
        method: "OPTIONS",
        headers: {
          origin: "http://127.0.0.1:5173",
          "access-control-request-method": "PUT",
          "access-control-request-headers": "content-type, x-user-id",
        },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("x-user-id");
  });

  it("creates one revision and replays the same mutation idempotently", async () => {
    const request = {
      schemaVersion: 1,
      baseRevision: 1,
      clientMutationId: "worker-save-1",
      chapterId: "chapter-0",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: "left" },
            content: [{ type: "text", text: "第一次 Worker 保存" }],
          },
        ],
      },
    };
    const save = () =>
      exports.default.fetch(
        new Request("http://example.com/api/documents/demo-post", {
          method: "PUT",
          headers: { "content-type": "application/json", "x-user-id": "author" },
          body: JSON.stringify(request),
        }),
      );

    const created = await save();
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({ revision: 2 });

    const replayed = await save();
    expect(replayed.status).toBe(200);
    await expect(replayed.json()).resolves.toMatchObject({ revision: 2 });

    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM document_revisions) AS revisions, " +
        "(SELECT revision FROM chapters WHERE id = 'chapter-0') AS chapter_revision",
    ).first<{ revisions: number; chapter_revision: number }>();
    expect(counts).toEqual({ revisions: 2, chapter_revision: 2 });

    const reused = await exports.default.fetch(
      new Request("http://example.com/api/documents/demo-post", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-user-id": "author" },
        body: JSON.stringify({ ...request, schemaVersion: 2 }),
      }),
    );
    expect(reused.status).toBe(409);
    await expect(reused.json()).resolves.toMatchObject({
      error: { code: "MUTATION_ID_REUSED" },
    });
  });

  it("allows exactly one concurrent writer for the same base revision", async () => {
    const save = (mutationId: string, text: string) =>
      exports.default.fetch(
        new Request("http://example.com/api/documents/demo-post", {
          method: "PUT",
          headers: { "content-type": "application/json", "x-user-id": "author" },
          body: JSON.stringify({
            schemaVersion: 1,
            baseRevision: 1,
            clientMutationId: mutationId,
            content: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  attrs: { textAlign: "left" },
                  content: [{ type: "text", text }],
                },
              ],
            },
          }),
        }),
      );

    const responses: Response[] = await Promise.all([
      save("concurrent-a", "并发写入 A"),
      save("concurrent-b", "并发写入 B"),
    ]);
    expect(responses.map((item) => item.status).sort()).toEqual([201, 409]);
    const conflict = responses.find((item) => item.status === 409)!;
    await expect(conflict.json()).resolves.toMatchObject({
      error: {
        code: "REVISION_CONFLICT",
        details: { currentRevision: 2, baseRevision: 1 },
      },
    });
    const revisionCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM document_revisions",
    ).first<{ count: number }>();
    expect(revisionCount?.count).toBe(2);
  });

  it("rolls back by creating a new immutable revision", async () => {
    const saveResponse = await exports.default.fetch(
      new Request("http://example.com/api/documents/demo-post", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-user-id": "author" },
        body: JSON.stringify({
          schemaVersion: 1,
          baseRevision: 1,
          clientMutationId: "before-rollback",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                attrs: { textAlign: "left" },
                content: [{ type: "text", text: "将被回滚" }],
              },
            ],
          },
        }),
      }),
    );
    expect(saveResponse.status).toBe(201);

    const rollback = await exports.default.fetch(
      new Request("http://example.com/api/documents/demo-post/rollback", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "author" },
        body: JSON.stringify({
          baseRevision: 2,
          targetRevision: 1,
          clientMutationId: "rollback-to-1",
        }),
      }),
    );
    expect(rollback.status).toBe(201);
    const result = (await rollback.json()) as { revision: number; content: unknown };
    expect(result.revision).toBe(3);
    expect(result.content).toEqual(content);

    const operation = await env.DB.prepare(
      "SELECT operation, target_revision FROM document_revisions WHERE revision = 3",
    ).first<{ operation: string; target_revision: number }>();
    expect(operation).toEqual({ operation: "rollback", target_revision: 1 });
  });

  it("rejects readers and unsafe document writes", async () => {
    const write = (userId: string, document: unknown) =>
      exports.default.fetch(
        new Request("http://example.com/api/documents/demo-post", {
          method: "PUT",
          headers: { "content-type": "application/json", "x-user-id": userId },
          body: JSON.stringify({
            schemaVersion: 1,
            baseRevision: 1,
            clientMutationId: "rejected-write-" + userId,
            content: document,
          }),
        }),
      );
    const forbidden = await write("reader", content);
    expect(forbidden.status).toBe(403);

    const unsafe = await write("author", {
      type: "doc",
      content: [
        {
          type: "richImage",
          attrs: { src: "javascript:alert(1)", alt: "bad", caption: "", align: "center", width: 100 },
        },
      ],
    });
    expect(unsafe.status).toBe(422);
    await expect(unsafe.json()).resolves.toMatchObject({
      error: { code: "UNSAFE_URL" },
    });
  });

  it("applies ProseMirror steps with audit history", async () => {
    const steps = [
      {
        stepType: "replace",
        from: 1,
        to: 2,
        slice: {
          content: [{ type: "text", text: "海" }],
          openStart: 0,
          openEnd: 0,
        },
      },
    ];
    const response = await exports.default.fetch(
      new Request("http://example.com/api/documents/demo-post/steps", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": "author" },
        body: JSON.stringify({
          schemaVersion: 1,
          baseRevision: 1,
          clientMutationId: "worker-steps-1",
          chapterId: "chapter-0",
          steps,
        }),
      }),
    );
    expect(response.status).toBe(201);
    const result = (await response.json()) as {
      revision: number;
      content: { content: Array<{ content?: Array<{ text?: string }> }> };
    };
    expect(result.revision).toBe(2);
    expect(result.content.content[0]?.content?.[0]?.text).toMatch(/^海/);

    const history = await exports.default.fetch(
      "http://example.com/api/documents/demo-post/revisions",
    );
    const historyBody = (await history.json()) as {
      items: Array<{ revision: number; operation: string; summary: string; stepsSummary: string | null }>;
    };
    expect(historyBody.items[0]).toMatchObject({
      revision: 2,
      operation: "steps",
      summary: "应用增量编辑",
    });
    expect(historyBody.items[0]?.stepsSummary).toBe("修改文字");
    const stepsSummary = await env.DB.prepare(
      "SELECT steps_json FROM document_revisions WHERE revision = 2",
    ).first<{ steps_json: string }>();
    expect(JSON.parse(stepsSummary!.steps_json)).toEqual(steps);
  });

  it("archives and restores inline comment anchors in the write batch", async () => {
    const save = (baseRevision: number, mutationId: string, withAnchor: boolean) =>
      exports.default.fetch(
        new Request("http://example.com/api/documents/demo-post", {
          method: "PUT",
          headers: { "content-type": "application/json", "x-user-id": "author" },
          body: JSON.stringify({
            schemaVersion: 1,
            baseRevision,
            clientMutationId: mutationId,
            content: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  attrs: { textAlign: "left" },
                  content: [
                    { type: "text", text: "带间贴的正文" },
                    ...(withAnchor
                      ? [
                          {
                            type: "inlineCommentAnchor",
                            attrs: { threadId: "anchor-worker", count: 0, placement: "end" },
                          },
                        ]
                      : []),
                  ],
                },
              ],
            },
          }),
        }),
      );

    expect((await save(1, "anchor-add", true)).status).toBe(201);
    const active = await env.DB.prepare(
      "SELECT archived FROM comment_threads WHERE anchor_id = 'anchor-worker'",
    ).first<{ archived: number }>();
    expect(active?.archived).toBe(0);

    expect((await save(2, "anchor-remove", false)).status).toBe(201);
    const archived = await env.DB.prepare(
      "SELECT archived FROM comment_threads WHERE anchor_id = 'anchor-worker'",
    ).first<{ archived: number }>();
    expect(archived?.archived).toBe(1);
  });

  it("registers chapters idempotently and hides content from readers", async () => {
    const chapteredContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, chapterStart: true }, content: [{ type: "text", text: "楔子" }] },
        { type: "paragraph", content: [{ type: "text", text: "公开章节" }] },
        { type: "heading", attrs: { level: 2, chapterStart: true }, content: [{ type: "text", text: "第一章" }] },
        { type: "paragraph", content: [{ type: "text", text: "隐藏章节正文" }] },
      ],
    };
    await env.DB.prepare(
      "UPDATE document_revisions SET content_json = ? WHERE document_id = 'demo-post' AND revision = 1",
    ).bind(JSON.stringify(chapteredContent)).run();
    const register = (title: string) =>
      exports.default.fetch(
        new Request("http://example.com/api/documents/demo-post/chapters", {
          method: "POST",
          headers: { "content-type": "application/json", "x-user-id": "author" },
          body: JSON.stringify({ title, order: 1 }),
        }),
      );
    const created = await register("第一章");
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      id: "chapter-1",
      revision: 0,
      title: "第一章",
    });

    const replayed = await register("第一章 · 新标题");
    expect(replayed.status).toBe(200);
    await expect(replayed.json()).resolves.toMatchObject({
      id: "chapter-1",
      revision: 0,
      title: "第一章 · 新标题",
    });

    const hidden = await exports.default.fetch(
      new Request("http://example.com/api/documents/demo-post/chapters/chapter-1", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": "author" },
        body: JSON.stringify({ hidden: true }),
      }),
    );
    expect(hidden.status).toBe(200);
    await expect(hidden.json()).resolves.toMatchObject({ hidden: true });

    const readerDirectory = await exports.default.fetch(
      new Request("http://example.com/api/forum/chapters", {
        headers: { "x-user-id": "reader" },
      }),
    );
    const readerItems = (await readerDirectory.json()) as { items: Array<{ id: string }> };
    expect(readerItems.items.some((item) => item.id === "chapter-1")).toBe(false);
    const readerDocument = await exports.default.fetch(
      new Request("http://example.com/api/documents/demo-post", {
        headers: { "x-user-id": "reader" },
      }),
    );
    expect(JSON.stringify((await readerDocument.json()) as unknown)).not.toContain("隐藏章节正文");

    const authorDirectory = await exports.default.fetch(
      new Request("http://example.com/api/forum/chapters", {
        headers: { "x-user-id": "author" },
      }),
    );
    const authorItems = (await authorDirectory.json()) as {
      items: Array<{ id: string; hidden: boolean }>;
    };
    expect(authorItems.items.find((item) => item.id === "chapter-1")?.hidden).toBe(true);
    const authorDocument = await exports.default.fetch(
      new Request("http://example.com/api/documents/demo-post", {
        headers: { "x-user-id": "author" },
      }),
    );
    expect(JSON.stringify((await authorDocument.json()) as unknown)).toContain("隐藏章节正文");
  });

  it("excludes the seed revision from a chapter created later", async () => {
    const registered = await exports.default.fetch(
      new Request("http://example.com/api/documents/demo-post/chapters", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "author" },
        body: JSON.stringify({ title: "第一章", order: 1 }),
      }),
    );
    expect(registered.status).toBe(201);
    const nextContent = {
      type: "doc",
      content: [
        ...content.content,
        { type: "heading", attrs: { level: 2, chapterStart: true }, content: [{ type: "text", text: "第一章" }] },
        { type: "paragraph", content: [{ type: "text", text: "后来新增" }] },
      ],
    };
    const saved = await exports.default.fetch(
      new Request("http://example.com/api/documents/demo-post", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-user-id": "author" },
        body: JSON.stringify({
          schemaVersion: 1,
          baseRevision: 1,
          clientMutationId: "new-worker-chapter",
          chapterId: "chapter-1",
          content: nextContent,
        }),
      }),
    );
    expect(saved.status).toBe(201);
    const history = await exports.default.fetch(
      "http://example.com/api/documents/demo-post/revisions?chapterId=chapter-1",
    );
    const page = (await history.json()) as { items: Array<{ revision: number }> };
    expect(page.items.map((item) => item.revision)).toEqual([2]);
  });

  it("deletes chapter metadata atomically while preserving suggestion history", async () => {
    await env.DB.prepare(
      "INSERT INTO suggestions(" +
        "id, document_id, chapter_id, chapter_title, line_no, line_text, from_text, to_text, " +
        "reason, status, author_id, reviewer_id, created_at, reviewed_at" +
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        "suggestion-delete-test",
        "demo-post",
        "chapter-0",
        "楔子 · 雨季之前",
        1,
        "原文",
        "原",
        "新",
        "测试",
        "pending",
        "reader",
        null,
        now,
        null,
      )
      .run();

    const remove = () =>
      exports.default.fetch(
        new Request("http://example.com/api/documents/demo-post/chapters/chapter-0", {
          method: "DELETE",
          headers: { "x-user-id": "author" },
        }),
      );
    const deleted = await remove();
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ id: "chapter-0", deleted: true });
    const suggestion = await env.DB.prepare(
      "SELECT chapter_id FROM suggestions WHERE id = 'suggestion-delete-test'",
    ).first<{ chapter_id: string | null }>();
    expect(suggestion?.chapter_id).toBeNull();

    const replayed = await remove();
    await expect(replayed.json()).resolves.toEqual({ id: "chapter-0", deleted: false });
  });

  it("compares chapter hashes without mutating D1", async () => {
    const response = await exports.default.fetch(
      new Request("http://example.com/api/forum/novels/demo-post/chapters/sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "author" },
        body: JSON.stringify({
          chapters: [
            { id: "chapter-0", title: "楔子", order: 0, hash: "hash" },
            { id: "chapter-new", title: "新章", order: 1, hash: "new-hash" },
          ],
        }),
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      toUpdate: ["chapter-new"],
      existing: ["chapter-0"],
    });
  });

  it("guards single-chapter saves with an atomic revision predicate", async () => {
    const save = (title: string) =>
      exports.default.fetch(
        new Request("http://example.com/api/forum/novels/demo-post/chapters/chapter-0", {
          method: "PUT",
          headers: { "content-type": "application/json", "x-user-id": "author" },
          body: JSON.stringify({
            title,
            order: 0,
            content: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  attrs: { textAlign: "left" },
                  content: [{ type: "text", text: title }],
                },
              ],
            },
            hash: "hash-" + title,
            baseRevision: 1,
          }),
        }),
      );

    const responses: Response[] = await Promise.all([save("章节 A"), save("章节 B")]);
    expect(responses.map((item) => item.status).sort()).toEqual([201, 409]);
    const success = responses.find((item) => item.status === 201)!;
    await expect(success.json()).resolves.toMatchObject({ id: "chapter-0", revision: 2 });
    const conflict = responses.find((item) => item.status === 409)!;
    await expect(conflict.json()).resolves.toMatchObject({
      error: {
        code: "CHAPTER_REVISION_CONFLICT",
        details: { currentRevision: 2, baseRevision: 1 },
      },
    });
    const row = await env.DB.prepare(
      "SELECT revision, content_hash FROM chapters WHERE id = 'chapter-0'",
    ).first<{ revision: number; content_hash: string }>();
    expect(row?.revision).toBe(2);
    expect(row?.content_hash).toMatch(/^hash-章节 [AB]$/);
  });

  it("rejects unauthorized or unsafe single-chapter saves", async () => {
    const save = (userId: string, chapterContent: unknown) =>
      exports.default.fetch(
        new Request("http://example.com/api/forum/novels/demo-post/chapters/chapter-0", {
          method: "PUT",
          headers: { "content-type": "application/json", "x-user-id": userId },
          body: JSON.stringify({
            title: "楔子",
            order: 0,
            content: chapterContent,
            hash: "unsafe-hash",
            baseRevision: 1,
          }),
        }),
      );
    expect((await save("reader", content)).status).toBe(403);
    const unsafe = await save("author", {
      type: "doc",
      content: [{ type: "unknownNode" }],
    });
    expect(unsafe.status).toBe(422);
    await expect(unsafe.json()).resolves.toMatchObject({
      error: { code: "UNSUPPORTED_NODE" },
    });
  });

  it("submits, filters, and atomically approves a single suggestion", async () => {
    const submitted = await exports.default.fetch(
      new Request("http://example.com/api/forum/documents/demo-post/suggestions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "reader" },
        body: JSON.stringify({
          fromText: "雾港",
          toText: "海港",
          reason: "统一地名",
          chapterId: "chapter-0",
          chapterTitle: "楔子 · 雨季之前",
          lineNo: 1,
          lineText: "Worker 中的雾港来信",
        }),
      }),
    );
    expect(submitted.status).toBe(201);
    const suggestion = (await submitted.json()) as { id: string };

    const readerList = await exports.default.fetch(
      new Request("http://example.com/api/forum/documents/demo-post/suggestions", {
        headers: { "x-user-id": "reader" },
      }),
    );
    await expect(readerList.json()).resolves.toMatchObject({
      items: [{ id: suggestion.id, authorId: "reader", status: "pending" }],
    });

    const approved = await exports.default.fetch(
      new Request("http://example.com/api/forum/suggestions/" + suggestion.id, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": "author" },
        body: JSON.stringify({ decision: "approve", baseRevision: 1 }),
      }),
    );
    expect(approved.status).toBe(200);
    await expect(approved.json()).resolves.toMatchObject({
      suggestion: { id: suggestion.id, status: "approved", reviewerId: "author" },
      document: { revision: 2 },
    });

    const state = await env.DB.prepare(
      "SELECT suggestion.status, suggestion.reviewer_id, document.current_revision, chapter.revision AS chapter_revision, " +
        "(SELECT COUNT(*) FROM document_mutations) AS mutations, " +
        "(SELECT COUNT(*) FROM suggestion_review_guards) AS guards " +
        "FROM suggestions suggestion " +
        "JOIN documents document ON document.id = suggestion.document_id " +
        "JOIN chapters chapter ON chapter.id = suggestion.chapter_id " +
        "WHERE suggestion.id = ?",
    )
      .bind(suggestion.id)
      .first<{
        status: string;
        reviewer_id: string;
        current_revision: number;
        chapter_revision: number;
        mutations: number;
        guards: number;
      }>();
    expect(state).toEqual({
      status: "approved",
      reviewer_id: "author",
      current_revision: 2,
      chapter_revision: 2,
      mutations: 1,
      guards: 1,
    });
  });

  it("allows only one concurrent approve or reject decision", async () => {
    const submitted = await exports.default.fetch(
      new Request("http://example.com/api/forum/documents/demo-post/suggestions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "reader" },
        body: JSON.stringify({
          fromText: "雾港",
          toText: "海港",
          reason: "并发审核",
          chapterId: "chapter-0",
          chapterTitle: "楔子",
          lineNo: 1,
          lineText: "Worker 中的雾港来信",
        }),
      }),
    );
    const suggestion = (await submitted.json()) as { id: string };
    const review = (decision: "approve" | "reject") =>
      exports.default.fetch(
        new Request("http://example.com/api/forum/suggestions/" + suggestion.id, {
          method: "PATCH",
          headers: { "content-type": "application/json", "x-user-id": "author" },
          body: JSON.stringify({ decision, baseRevision: 1 }),
        }),
      );

    const responses: Response[] = await Promise.all([review("approve"), review("reject")]);
    expect(responses.map((item) => item.status).sort()).toEqual([200, 409]);
    const row = await env.DB.prepare(
      "SELECT status FROM suggestions WHERE id = ?",
    )
      .bind(suggestion.id)
      .first<{ status: "approved" | "rejected" }>();
    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM suggestion_review_guards) AS guards, " +
        "(SELECT COUNT(*) FROM document_revisions) AS revisions, " +
        "(SELECT current_revision FROM documents WHERE id = 'demo-post') AS current_revision",
    ).first<{ guards: number; revisions: number; current_revision: number }>();
    expect(counts?.guards).toBe(1);
    if (row?.status === "approved") {
      expect(counts).toMatchObject({ revisions: 2, current_revision: 2 });
    } else {
      expect(counts).toMatchObject({ revisions: 1, current_revision: 1 });
    }
  });

  it("validates and atomically approves a chapter suggestion batch", async () => {
    const before = {
      type: "doc" as const,
      content: [
        {
          type: "heading",
          attrs: { textAlign: "left", chapterStart: true, level: 2 },
          content: [{ type: "text", text: "第一章" }],
        },
        {
          type: "paragraph",
          attrs: { textAlign: "left" },
          content: [{ type: "text", text: "旧章节正文" }],
        },
      ],
    };
    const after = structuredClone(before);
    after.content[1]!.content![0]!.text = "新章节正文";
    const fullBefore = {
      type: "doc" as const,
      content: [
        {
          type: "heading",
          attrs: { textAlign: "left", chapterStart: false, level: 1 },
          content: [{ type: "text", text: "测试小说" }],
        },
        ...before.content,
      ],
    };
    const fullAfter = {
      type: "doc" as const,
      content: [fullBefore.content[0]!, ...after.content],
    };
    const steps = diffDocuments(fullBefore, fullAfter) as unknown as Array<Record<string, unknown>>;
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE document_revisions SET content_json = ? WHERE document_id = 'demo-post' AND revision = 1",
      ).bind(JSON.stringify(fullBefore)),
      env.DB.prepare(
        "UPDATE chapters SET content_json = ?, content_hash = ? WHERE id = 'chapter-0'",
      ).bind(JSON.stringify(before), "batch-before"),
    ]);

    const submitted = await exports.default.fetch(
      new Request("http://example.com/api/forum/documents/demo-post/suggestion-batches", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "reader" },
        body: JSON.stringify({
          baseRevision: 1,
          chapterId: "chapter-0",
          chapterTitle: "第一章",
          beforeContent: before,
          afterContent: after,
          steps,
          reason: "整章调整",
        }),
      }),
    );
    expect(submitted.status, await submitted.clone().text()).toBe(201);
    const batch = (await submitted.json()) as { id: string };

    const approved = await exports.default.fetch(
      new Request("http://example.com/api/forum/suggestion-batches/" + batch.id, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": "author" },
        body: JSON.stringify({ decision: "approve", baseRevision: 1 }),
      }),
    );
    expect(approved.status).toBe(200);
    await expect(approved.json()).resolves.toMatchObject({
      batch: { id: batch.id, status: "approved", reviewerId: "author" },
      document: { revision: 2 },
    });
    const state = await env.DB.prepare(
      "SELECT batch.status, document.current_revision, chapter.revision AS chapter_revision, " +
        "revision.operation, revision.steps_json " +
        "FROM suggestion_batches batch " +
        "JOIN documents document ON document.id = batch.document_id " +
        "JOIN chapters chapter ON chapter.id = batch.chapter_id " +
        "JOIN document_revisions revision ON revision.document_id = document.id AND revision.revision = 2 " +
        "WHERE batch.id = ?",
    )
      .bind(batch.id)
      .first<{
        status: string;
        current_revision: number;
        chapter_revision: number;
        operation: string;
        steps_json: string;
      }>();
    expect(state).toMatchObject({
      status: "approved",
      current_revision: 2,
      chapter_revision: 2,
      operation: "suggestion",
    });
    expect(JSON.parse(state!.steps_json)).toHaveLength(steps.length);
  });

  it("creates nested comment trees, records receipts, and aggregates votes", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO comment_threads(document_id, anchor_id, archived, created_at) VALUES (?, ?, 0, ?)",
      ).bind("demo-post", "anchor-comments", now),
      env.DB.prepare("INSERT INTO wallets(user_id, balance) VALUES (?, ?)").bind("reader", 25),
    ]);
    const createReply = (userId: string, anchorId: string, parentId: string | null, text: string) =>
      exports.default.fetch(
        new Request(
          "http://example.com/api/documents/demo-post/comments/" + anchorId + "/replies",
          {
            method: "POST",
            headers: { "content-type": "application/json", "x-user-id": userId },
            body: JSON.stringify({ parentId, body: text }),
          },
        ),
      );
    const rootResponse = await createReply("reader", "anchor-comments", null, "根回复");
    expect(rootResponse.status).toBe(201);
    const root = (await rootResponse.json()) as { id: string; author: { coins: number } };
    expect(root.author.coins).toBe(25);
    const receipt = await env.DB.prepare(
      "SELECT 1 AS found FROM reply_receipts WHERE document_id = 'demo-post' AND user_id = 'reader'",
    ).first<{ found: number }>();
    expect(receipt?.found).toBe(1);

    const childResponse = await createReply("author", "anchor-comments", root.id, "楼中楼");
    expect(childResponse.status).toBe(201);
    const child = (await childResponse.json()) as { id: string };

    const vote = async (userId: string, value: -1 | 0 | 1) =>
      exports.default.fetch(
        new Request("http://example.com/api/comments/replies/" + root.id + "/vote", {
          method: "PUT",
          headers: { "content-type": "application/json", "x-user-id": userId },
          body: JSON.stringify({ value }),
        }),
      );
    expect((await vote("author", 1)).status).toBe(200);
    const readerVote = await vote("reader", -1);
    await expect(readerVote.json()).resolves.toEqual({
      score: 0,
      viewerVote: -1,
      upvotes: 1,
      downvotes: 1,
      myVote: -1,
    });

    const thread = await exports.default.fetch(
      new Request(
        "http://example.com/api/documents/demo-post/comments/anchor-comments?sort=score&limit=20",
        { headers: { "x-user-id": "reader" } },
      ),
    );
    expect(thread.status).toBe(200);
    await expect(thread.json()).resolves.toMatchObject({
      archived: false,
      total: 2,
      items: [
        {
          id: root.id,
          viewerVote: -1,
          children: [{ id: child.id }],
        },
      ],
    });

    const removed = await vote("reader", 0);
    await expect(removed.json()).resolves.toMatchObject({
      score: 1,
      viewerVote: 0,
      upvotes: 1,
      downvotes: 0,
    });
  });

  it("keeps archived comment threads readable and rejects invalid parents", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO comment_threads(document_id, anchor_id, archived, created_at) VALUES (?, ?, 0, ?)",
      ).bind("demo-post", "anchor-main", now),
      env.DB.prepare(
        "INSERT INTO comment_threads(document_id, anchor_id, archived, created_at) VALUES (?, ?, 0, ?)",
      ).bind("demo-post", "anchor-other", now),
    ]);
    const create = (anchorId: string, parentId: string | null, text: string) =>
      exports.default.fetch(
        new Request(
          "http://example.com/api/documents/demo-post/comments/" + anchorId + "/replies",
          {
            method: "POST",
            headers: { "content-type": "application/json", "x-user-id": "reader" },
            body: JSON.stringify({ parentId, body: text }),
          },
        ),
      );
    const other = (await (await create("anchor-other", null, "其他线程")).json()) as {
      id: string;
    };
    const invalidParent = await create("anchor-main", other.id, "错误父级");
    expect(invalidParent.status).toBe(404);
    await expect(invalidParent.json()).resolves.toMatchObject({
      error: { code: "PARENT_REPLY_NOT_FOUND" },
    });

    const root = await create("anchor-main", null, "归档前回复");
    expect(root.status).toBe(201);
    await env.DB.prepare(
      "UPDATE comment_threads SET archived = 1 WHERE document_id = ? AND anchor_id = ?",
    )
      .bind("demo-post", "anchor-main")
      .run();
    const archivedReply = await create("anchor-main", null, "归档后回复");
    expect(archivedReply.status).toBe(409);
    await expect(archivedReply.json()).resolves.toMatchObject({
      error: { code: "COMMENT_THREAD_ARCHIVED" },
    });
    const archivedThread = await exports.default.fetch(
      new Request("http://example.com/api/documents/demo-post/comments/anchor-main", {
        headers: { "x-user-id": "reader" },
      }),
    );
    await expect(archivedThread.json()).resolves.toMatchObject({
      archived: true,
      total: 1,
    });
  });

  it("searches and resolves mentions", async () => {
    const search = await exports.default.fetch(
      new Request("http://example.com/api/forum/users/search?q=%E6%9E%97&friendsOnly=true", {
        headers: { "x-user-id": "reader" },
      }),
    );
    expect(search.status).toBe(200);
    await expect(search.json()).resolves.toMatchObject({
      items: [{ id: "author", name: "林见", isFriend: true }],
    });

    const resolved = await exports.default.fetch(
      new Request("http://example.com/api/forum/mentions/resolve", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "reader" },
        body: JSON.stringify({ name: "任意旧名称", userId: "author" }),
      }),
    );
    await expect(resolved.json()).resolves.toMatchObject({
      resolved: true,
      displayText: "@林见",
      user: { id: "author" },
    });

    const unresolved = await exports.default.fetch(
      new Request("http://example.com/api/forum/mentions/resolve", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "reader" },
        body: JSON.stringify({ name: "不存在的人" }),
      }),
    );
    await expect(unresolved.json()).resolves.toEqual({
      resolved: false,
      displayText: "@不存在的人",
      user: null,
    });
  });

  it("unlocks reply-gated content through the comment receipt trigger", async () => {
    const hiddenContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "left" },
          content: [{ type: "text", text: "回复后可见的线索" }],
        },
      ],
    };
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO reply_gates(id, document_id, content_json) VALUES (?, ?, ?)",
      ).bind("gate-worker", "demo-post", JSON.stringify(hiddenContent)),
      env.DB.prepare(
        "INSERT INTO comment_threads(document_id, anchor_id, archived, created_at) VALUES (?, ?, 0, ?)",
      ).bind("demo-post", "anchor-gate", now),
    ]);
    const resolve = () =>
      exports.default.fetch(
        new Request("http://example.com/api/forum/reply-gates/resolve", {
          method: "POST",
          headers: { "content-type": "application/json", "x-user-id": "reader" },
          body: JSON.stringify({ gateId: "gate-worker", documentId: "demo-post" }),
        }),
      );
    await expect((await resolve()).json()).resolves.toEqual({
      visible: false,
      content: null,
      message: "回复主帖后可见",
    });

    const reply = await exports.default.fetch(
      new Request("http://example.com/api/documents/demo-post/comments/anchor-gate/replies", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "reader" },
        body: JSON.stringify({ parentId: null, body: "解锁回复" }),
      }),
    );
    expect(reply.status).toBe(201);
    await expect((await resolve()).json()).resolves.toMatchObject({
      visible: true,
      content: hiddenContent,
      message: "已满足查看条件",
    });
  });

  it("submits, replaces, and lists named poll votes atomically", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO polls(id, question, multiple, minimum_role) VALUES (?, ?, 0, 'reader')",
      ).bind("poll-worker", "选择方向"),
      env.DB.prepare(
        "INSERT INTO poll_options(id, poll_id, label, sort_order) VALUES (?, ?, ?, ?)",
      ).bind("poll-a", "poll-worker", "向东", 1),
      env.DB.prepare(
        "INSERT INTO poll_options(id, poll_id, label, sort_order) VALUES (?, ?, ?, ?)",
      ).bind("poll-b", "poll-worker", "向西", 2),
    ]);
    const submit = (optionId: string) =>
      exports.default.fetch(
        new Request("http://example.com/api/forum/polls/poll-worker/votes", {
          method: "POST",
          headers: { "content-type": "application/json", "x-user-id": "reader" },
          body: JSON.stringify({ optionIds: [optionId] }),
        }),
      );
    const first = await submit("poll-a");
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ viewerOptionIds: ["poll-a"] });

    const concurrent: Response[] = await Promise.all([submit("poll-a"), submit("poll-b")]);
    expect(concurrent.map((item) => item.status)).toEqual([200, 200]);
    const selected = await env.DB.prepare(
      "SELECT selected.option_id FROM poll_votes vote " +
        "JOIN poll_vote_options selected ON selected.vote_id = vote.id " +
        "WHERE vote.poll_id = 'poll-worker' AND vote.user_id = 'reader'",
    ).all<{ option_id: string }>();
    expect(selected.results).toHaveLength(1);
    expect(["poll-a", "poll-b"]).toContain(selected.results[0]?.option_id);

    const details = await exports.default.fetch(
      new Request("http://example.com/api/forum/polls/poll-worker/votes?limit=1", {
        headers: { "x-user-id": "author" },
      }),
    );
    await expect(details.json()).resolves.toMatchObject({
      items: [
        {
          user: { id: "reader" },
          optionIds: [selected.results[0]!.option_id],
        },
      ],
      pageInfo: { nextCursor: null },
    });

    const invalidChoice = await exports.default.fetch(
      new Request("http://example.com/api/forum/polls/poll-worker/votes", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "reader" },
        body: JSON.stringify({ optionIds: ["poll-a", "poll-b"] }),
      }),
    );
    expect(invalidChoice.status).toBe(422);
    await expect(invalidChoice.json()).resolves.toMatchObject({
      error: { code: "POLL_SINGLE_CHOICE" },
    });
  });

  it("enforces poll role eligibility", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO polls(id, question, multiple, minimum_role) VALUES (?, ?, 0, 'moderator')",
      ).bind("poll-moderator", "版主投票"),
      env.DB.prepare(
        "INSERT INTO poll_options(id, poll_id, label, sort_order) VALUES (?, ?, ?, 1)",
      ).bind("poll-mod-a", "poll-moderator", "通过"),
    ]);
    const response = await exports.default.fetch(
      new Request("http://example.com/api/forum/polls/poll-moderator/votes", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "reader" },
        body: JSON.stringify({ optionIds: ["poll-mod-a"] }),
      }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "POLL_INELIGIBLE" },
    });
  });

  it("charges exactly once for concurrent duplicate attachment purchases", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO wallets(user_id, balance) VALUES (?, ?)").bind("reader", 100),
      env.DB.prepare("INSERT INTO wallets(user_id, balance) VALUES (?, ?)").bind("author", 10),
      env.DB.prepare(
        "INSERT INTO attachments(id, name, mime_type, price, author_id, asset_id, legacy_download_url) " +
          "VALUES (?, ?, ?, ?, ?, NULL, ?)",
      ).bind("attachment-worker", "设定集.txt", "text/plain", 30, "author", "/downloads/setting.txt"),
    ]);
    const before = await exports.default.fetch(
      new Request("http://example.com/api/forum/attachments/attachment-worker", {
        headers: { "x-user-id": "reader" },
      }),
    );
    await expect(before.json()).resolves.toMatchObject({
      purchased: false,
      downloadUrl: null,
    });

    const purchase = () =>
      exports.default.fetch(
        new Request("http://example.com/api/forum/attachments/attachment-worker/purchase", {
          method: "POST",
          headers: { "x-user-id": "reader" },
        }),
      );
    const responses: Response[] = await Promise.all([purchase(), purchase()]);
    expect(responses.map((item) => item.status)).toEqual([200, 200]);
    const payloads = await Promise.all(responses.map((item) => item.json())) as Array<{
      alreadyPurchased: boolean;
      buyerBalance: number;
      authorIncome: number;
    }>;
    expect(payloads.map((item) => item.alreadyPurchased).sort()).toEqual([false, true]);
    expect(payloads.every((item) => item.buyerBalance === 70)).toBe(true);
    expect(payloads.every((item) => item.authorIncome === 21)).toBe(true);

    const state = await env.DB.prepare(
      "SELECT (SELECT balance FROM wallets WHERE user_id = 'reader') AS buyer, " +
        "(SELECT balance FROM wallets WHERE user_id = 'author') AS author, " +
        "(SELECT COUNT(*) FROM attachment_purchases) AS purchases",
    ).first<{ buyer: number; author: number; purchases: number }>();
    expect(state).toEqual({ buyer: 70, author: 31, purchases: 1 });
  });

  it("prevents concurrent purchases from making a wallet negative", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO wallets(user_id, balance) VALUES (?, ?)").bind("reader", 100),
      env.DB.prepare("INSERT INTO wallets(user_id, balance) VALUES (?, ?)").bind("author", 0),
      env.DB.prepare(
        "INSERT INTO attachments(id, name, mime_type, price, author_id, asset_id, legacy_download_url) " +
          "VALUES (?, ?, 'text/plain', 60, 'author', NULL, ?)",
      ).bind("attachment-a", "附件 A", "/downloads/a.txt"),
      env.DB.prepare(
        "INSERT INTO attachments(id, name, mime_type, price, author_id, asset_id, legacy_download_url) " +
          "VALUES (?, ?, 'text/plain', 60, 'author', NULL, ?)",
      ).bind("attachment-b", "附件 B", "/downloads/b.txt"),
    ]);
    const purchase = (id: string) =>
      exports.default.fetch(
        new Request("http://example.com/api/forum/attachments/" + id + "/purchase", {
          method: "POST",
          headers: { "x-user-id": "reader" },
        }),
      );
    const responses: Response[] = await Promise.all([
      purchase("attachment-a"),
      purchase("attachment-b"),
    ]);
    expect(responses.map((item) => item.status).sort()).toEqual([200, 402]);
    const state = await env.DB.prepare(
      "SELECT (SELECT balance FROM wallets WHERE user_id = 'reader') AS buyer, " +
        "(SELECT balance FROM wallets WHERE user_id = 'author') AS author, " +
        "(SELECT COUNT(*) FROM attachment_purchases) AS purchases",
    ).first<{ buyer: number; author: number; purchases: number }>();
    expect(state).toEqual({ buyer: 40, author: 42, purchases: 1 });
  });

  it("uploads signed images to R2 and supports immutable conditional ranges", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const form = new FormData();
    form.set("file", new File([png], "tiny.png", { type: "image/png" }));
    const uploaded = await exports.default.fetch(
      new Request("http://example.com/api/assets", {
        method: "POST",
        headers: { "x-user-id": "reader" },
        body: form,
      }),
    );
    expect(uploaded.status).toBe(201);
    const asset = (await uploaded.json()) as { id: string; url: string; size: number };
    expect(asset.size).toBe(png.byteLength);
    const metadata = await env.DB.prepare(
      "SELECT object_key, checksum, state FROM assets WHERE id = ?",
    )
      .bind(asset.id)
      .first<{ object_key: string; checksum: string; state: string }>();
    expect(metadata).toMatchObject({ state: "ready" });
    expect(metadata?.checksum).toHaveLength(64);
    expect(await env.UPLOADS.head(metadata!.object_key)).not.toBeNull();

    const loaded = await exports.default.fetch(
      new Request("http://example.com" + asset.url, {
        headers: { "x-user-id": "reader" },
      }),
    );
    expect(loaded.status).toBe(200);
    expect(new Uint8Array(await loaded.arrayBuffer())).toEqual(png);
    expect(loaded.headers.get("content-type")).toBe("image/png");
    expect(loaded.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    const etag = loaded.headers.get("etag")!;

    const notModified = await exports.default.fetch(
      new Request("http://example.com" + asset.url, {
        headers: { "if-none-match": etag, "x-user-id": "reader" },
      }),
    );
    expect(notModified.status).toBe(304);

    const partial = await exports.default.fetch(
      new Request("http://example.com" + asset.url, {
        headers: { range: "bytes=0-3", "x-user-id": "reader" },
      }),
    );
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 0-3/8");
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(png.slice(0, 4));
  });

  it("rejects invalid images and marks failed R2 uploads", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "fake.png", { type: "image/png" }));
    const invalid = await exports.default.fetch(
      new Request("http://example.com/api/assets", {
        method: "POST",
        headers: { "x-user-id": "reader" },
        body: form,
      }),
    );
    expect(invalid.status).toBe(415);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "UNSUPPORTED_IMAGE" },
    });

    const missing = await exports.default.fetch(
      new Request("http://example.com/api/assets", {
        method: "POST",
        headers: { "x-user-id": "reader" },
        body: new FormData(),
      }),
    );
    expect(missing.status).toBe(422);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: "ASSET_FILE_REQUIRED" },
    });

    const oversizedForm = new FormData();
    oversizedForm.set(
      "file",
      new File(
        [
          new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          new Uint8Array(8 * 1024 * 1024),
        ],
        "large.png",
        { type: "image/png" },
      ),
    );
    const oversized = await exports.default.fetch(
      new Request("http://example.com/api/assets", {
        method: "POST",
        headers: { "x-user-id": "reader" },
        body: oversizedForm,
      }),
    );
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({
      error: { code: "ASSET_TOO_LARGE" },
    });

    const failingBucket = {
      put: async () => {
        throw new Error("simulated R2 outage");
      },
      get: async () => null,
      delete: async () => undefined,
    } as unknown as R2Bucket;
    const repository = new D1AssetRepository(env.DB, failingBucket);
    const file = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "failed.png",
      { type: "image/png" },
    );
    await expect(
      repository.upload(file, {
        id: "reader",
        name: "小满",
        role: "reader",
        isFriend: true,
        bio: "读者",
      }),
    ).rejects.toThrow("simulated R2 outage");
    const failed = await env.DB.prepare(
      "SELECT state FROM assets WHERE original_name = 'failed.png' ORDER BY created_at DESC LIMIT 1",
    ).first<{ state: string }>();
    expect(failed?.state).toBe("failed");
  });

  it("protects R2 objects referenced by paid attachments", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const form = new FormData();
    form.set("file", new File([bytes], "paid.png", { type: "image/png" }));
    const uploaded = await exports.default.fetch(
      new Request("http://example.com/api/assets", {
        method: "POST",
        headers: { "x-user-id": "author" },
        body: form,
      }),
    );
    const asset = (await uploaded.json()) as { id: string; url: string };
    await env.DB.batch([
      env.DB.prepare("INSERT INTO wallets(user_id, balance) VALUES (?, ?)").bind("reader", 100),
      env.DB.prepare("INSERT INTO wallets(user_id, balance) VALUES (?, ?)").bind("author", 0),
      env.DB.prepare(
        "INSERT INTO attachments(id, name, mime_type, price, author_id, asset_id, legacy_download_url) " +
          "VALUES (?, ?, ?, ?, ?, ?, NULL)",
      ).bind("paid-r2", "付费原图.png", "image/png", 20, "author", asset.id),
    ]);

    const denied = await exports.default.fetch(
      new Request("http://example.com" + asset.url, {
        headers: { "x-user-id": "reader" },
      }),
    );
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({
      error: { code: "ATTACHMENT_NOT_PURCHASED" },
    });

    const purchased = await exports.default.fetch(
      new Request("http://example.com/api/forum/attachments/paid-r2/purchase", {
        method: "POST",
        headers: { "x-user-id": "reader" },
      }),
    );
    expect(purchased.status).toBe(200);
    await expect(purchased.json()).resolves.toMatchObject({
      attachment: { downloadUrl: asset.url, purchased: true },
    });

    const allowed = await exports.default.fetch(
      new Request("http://example.com" + asset.url, {
        headers: { "x-user-id": "reader" },
      }),
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("cache-control")).toBe("private, no-store");
    expect(allowed.headers.get("content-disposition")).toContain("attachment");
    expect(new Uint8Array(await allowed.arrayBuffer())).toEqual(bytes);
  });

  it("cleans stale pending R2 objects and metadata", async () => {
    const objectKey = "images/stale-worker.png";
    const old = "2020-01-01T00:00:00.000Z";
    await env.UPLOADS.put(objectKey, new Uint8Array([1, 2, 3]));
    await env.DB.prepare(
      "INSERT INTO assets(" +
        "id, original_name, object_key, mime_type, byte_size, checksum, state, " +
        "created_by, created_at, updated_at" +
        ") VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
    )
      .bind(
        "stale-worker",
        "stale.png",
        objectKey,
        "image/png",
        3,
        "checksum",
        "reader",
        old,
        old,
      )
      .run();
    expect(await cleanupStaleAssets(env.DB, env.UPLOADS, now)).toBe(1);
    expect(await env.UPLOADS.head(objectKey)).toBeNull();
    const row = await env.DB.prepare(
      "SELECT 1 AS found FROM assets WHERE id = 'stale-worker'",
    ).first<{ found: number }>();
    expect(row).toBeNull();
  });

  it("persists stable dice rolls and explicit reroll chains in workerd", async () => {
    const create = await exports.default.fetch(
      new Request("http://example.com/api/dice", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "reader" },
        body: JSON.stringify({ expression: "2d6" }),
      }),
    );
    expect(create.status).toBe(201);
    const first = (await create.json()) as {
      rollId: string;
      rootRollId: string;
      rolls: number[];
      total: number;
    };
    expect(first.rolls).toHaveLength(2);
    expect(first.total).toBeGreaterThanOrEqual(2);
    expect(first.total).toBeLessThanOrEqual(12);

    const loaded = await exports.default.fetch(
      "http://example.com/api/dice/" + first.rollId,
    );
    await expect(loaded.json()).resolves.toEqual(first);

    const rerolled = await exports.default.fetch(
      new Request("http://example.com/api/dice/" + first.rollId + "/reroll", {
        method: "POST",
        headers: { "x-user-id": "reader" },
      }),
    );
    expect(rerolled.status).toBe(201);
    await expect(rerolled.json()).resolves.toMatchObject({
      rootRollId: first.rootRollId,
      rerollOf: first.rollId,
      expression: "2d6",
    });

    const invalid = await exports.default.fetch(
      new Request("http://example.com/api/dice", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "reader" },
        body: JSON.stringify({ expression: "not dice" }),
      }),
    );
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "INVALID_DICE_EXPRESSION" },
    });
  });

  it("logs in with a D1 password credential and rate-limits repeated failures", async () => {
    const salt = new TextEncoder().encode("1234567890abcdef");
    const encodedSalt = btoa(String.fromCharCode(...salt)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    const hash = await derivePasswordHash("correct-password", salt, 100_000);
    await env.DB.prepare(
      "INSERT INTO password_credentials(user_id, username, salt, password_hash, iterations, failed_attempts, locked_until, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, 0, NULL, ?)",
    ).bind("author", "writer", encodedSalt, hash, 100_000, now).run();

    const login = await exports.default.fetch(
      new Request("http://example.com/api/auth/password/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "writer", password: "correct-password" }),
      }),
    );
    expect(login.status).toBe(204);
    expect(login.headers.get("set-cookie")).toContain("ricetext_session=");
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    expect(login.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(login.headers.get("set-cookie")).not.toContain("Secure");

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const failed = await exports.default.fetch(
        new Request("http://example.com/api/auth/password/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: "writer", password: "wrong-password" }),
        }),
      );
      expect(failed.status).toBe(401);
    }
    const rateLimited = await exports.default.fetch(
      new Request("http://example.com/api/auth/password/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "writer", password: "correct-password" }),
      }),
    );
    expect(rateLimited.status).toBe(429);
    await expect(rateLimited.json()).resolves.toMatchObject({
      error: { code: "AUTH_RATE_LIMITED" },
    });
  });

  it("enforces production Origin checks and ignores demo identity headers", async () => {
    const productionEnv: WorkerEnv = {
      DB: env.DB,
      UPLOADS: env.UPLOADS,
      ENVIRONMENT: "production",
      ALLOW_DEMO_AUTH: "false",
      ALLOWED_ORIGINS: "https://app.example.com",
    };
    const context = createExecutionContext();
    const preflight = await worker.fetch(
      new Request("https://app.example.com/api/documents/demo-post", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "PUT",
        },
      }),
      productionEnv,
      context,
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).not.toContain("x-user-id");
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );

    const forbiddenOrigin = await worker.fetch(
      new Request("https://app.example.com/api/documents/demo-post", {
        method: "PUT",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({}),
      }),
      productionEnv,
      context,
    );
    expect(forbiddenOrigin.status).toBe(403);
    await expect(forbiddenOrigin.json()).resolves.toMatchObject({
      error: { code: "ORIGIN_FORBIDDEN" },
    });

    const fakeIdentity = await worker.fetch(
      new Request("https://app.example.com/api/forum/session", {
        headers: { "x-user-id": "author" },
      }),
      productionEnv,
      context,
    );
    expect(fakeIdentity.status).toBe(401);
  });

  it("completes OIDC PKCE login, creates a reader session, and logs out", async () => {
    const issuer = "https://identity.example.test";
    const clientId = "ricetext-test";
    const productionEnv: WorkerEnv = {
      DB: env.DB,
      UPLOADS: env.UPLOADS,
      ENVIRONMENT: "production",
      ALLOW_DEMO_AUTH: "false",
      ALLOWED_ORIGINS: "https://app.example.com",
      OIDC_ISSUER: issuer,
      OIDC_CLIENT_ID: clientId,
      OIDC_CLIENT_SECRET: "test-secret",
    };
    network.use(
      http.get(issuer + "/.well-known/openid-configuration", () =>
        HttpResponse.json({
          issuer,
          authorization_endpoint: issuer + "/authorize",
          token_endpoint: issuer + "/token",
          jwks_uri: issuer + "/jwks",
        }),
      ),
    );
    const context = createExecutionContext();
    const login = await worker.fetch(
      new Request(
        "https://app.example.com/api/auth/login?returnTo=" +
          encodeURIComponent("https://app.example.com/compose"),
      ),
      productionEnv,
      context,
    );
    expect(login.status).toBe(302);
    const location = new URL(login.headers.get("location")!);
    expect(location.origin).toBe(issuer);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    const state = location.searchParams.get("state")!;
    const stateCookie = login.headers.get("set-cookie")!.match(/ricetext_oidc_state=([^;]+)/)![1]!;
    expect(decodeURIComponent(stateCookie)).toBe(state);
    const storedState = await env.DB.prepare(
      "SELECT nonce FROM auth_login_states ORDER BY created_at DESC LIMIT 1",
    ).first<{ nonce: string }>();

    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const idToken = await new SignJWT({
      nonce: storedState!.nonce,
      name: "OIDC 新读者",
      role: "moderator",
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience(clientId)
      .setSubject("external-user-1")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    network.use(
      http.post(issuer + "/token", () => HttpResponse.json({ id_token: idToken })),
      http.get(issuer + "/jwks", () =>
        HttpResponse.json({ keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }] }),
      ),
    );

    const callback = await worker.fetch(
      new Request(
        "https://app.example.com/api/auth/callback?code=test-code&state=" +
          encodeURIComponent(state),
        { headers: { cookie: "ricetext_oidc_state=" + stateCookie } },
      ),
      productionEnv,
      context,
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("https://app.example.com/compose");
    const cookies = callback.headers.get("set-cookie")!;
    const sessionValue = cookies.match(/ricetext_session=([^;]+)/)![1]!;
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("Secure");
    expect(cookies).toContain("SameSite=Lax");

    const replay = await worker.fetch(
      new Request(
        "https://app.example.com/api/auth/callback?code=test-code&state=" +
          encodeURIComponent(state),
        { headers: { cookie: "ricetext_oidc_state=" + stateCookie } },
      ),
      productionEnv,
      context,
    );
    expect(replay.status).toBe(401);

    const session = await worker.fetch(
      new Request("https://app.example.com/api/forum/session", {
        headers: { cookie: "ricetext_session=" + sessionValue },
      }),
      productionEnv,
      context,
    );
    expect(session.status).toBe(200);
    await expect(session.json()).resolves.toMatchObject({
      current: { name: "OIDC 新读者", role: "reader" },
      available: [{ name: "OIDC 新读者", role: "reader" }],
    });

    const logout = await worker.fetch(
      new Request("https://app.example.com/api/auth/logout", {
        method: "POST",
        headers: {
          cookie: "ricetext_session=" + sessionValue,
          origin: "https://app.example.com",
        },
      }),
      productionEnv,
      context,
    );
    expect(logout.status).toBe(204);
    const sessions = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM auth_sessions",
    ).first<{ count: number }>();
    expect(sessions?.count).toBe(0);
  });

  it("returns stable contract errors", async () => {
    const missing = await exports.default.fetch(
      "http://example.com/api/documents/missing-document",
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      error: { code: "DOCUMENT_NOT_FOUND", message: "文档不存在" },
    });

    const invalid = await exports.default.fetch(
      "http://example.com/api/documents/demo-post/revisions/not-a-number",
    );
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });
});
