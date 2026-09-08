import { env, exports } from "cloudflare:workers";
import type { DocumentEnvelope, Suggestion } from "@ricetext/contracts";
import { beforeEach, describe, expect, it } from "vitest";

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const h = (text: string) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
const content = { type: "doc", content: [h("First"), p("target typo"), h("Second"), p("other typo"), p("target typo"), p("duplicate typo typo"), p("unique source")] };
const location = { chapterId: "chapter-0", chapterTitle: "Untrusted title", lineNo: 3, lineText: "target typo" };
const now = new Date(0).toISOString();
let documentId: string;
let otherId: string;

const request = (path: string, method = "GET", body?: unknown) => exports.default.fetch(new Request("http://example.com" + path, {
  method,
  headers: { "content-type": "application/json", "x-user-id": "author" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}));
async function submit(overrides = {}, fromText = "typo", toText = "fixed"): Promise<Suggestion> {
  const response = await request("/api/forum/documents/" + documentId + "/suggestions", "POST", { ...location, fromText, toText, reason: "", ...overrides });
  expect(response.status).toBe(201);
  return await response.json() as Suggestion;
}
const review = (id: string) => request("/api/forum/suggestions/" + id, "PATCH", { decision: "approve", baseRevision: 1 });

beforeEach(async () => {
  documentId = "suggestion-" + crypto.randomUUID();
  otherId = "other-" + crypto.randomUUID();
  await env.DB.prepare("INSERT OR IGNORE INTO users(id, name, role, is_friend, bio, created_at, updated_at) VALUES ('author', 'Author', 'author', 1, '', ?, ?)").bind(now, now).run();
  for (const id of [documentId, otherId]) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO documents(id, title, schema_version, current_revision, created_by, created_at, updated_at) VALUES (?, ?, 1, 1, 'author', ?, ?)").bind(id, id, now, now),
      env.DB.prepare("INSERT INTO document_revisions(document_id, revision, schema_version, content_json, author_id, operation, created_at) VALUES (?, 1, 1, ?, 'author', 'seed', ?)").bind(id, JSON.stringify(content), now),
    ]);
  }
  for (const [id, docId, order] of [["first", documentId, 0], ["chapter-0", documentId, 1], ["chapter-0", otherId, 0]] as const) {
    await env.DB.prepare("INSERT INTO chapters(id, document_id, title, sort_order, revision, updated_at) VALUES (?, ?, ?, ?, 1, ?)").bind(id, docId, id, order, now).run();
  }
});

describe("Worker 建议安全定位", () => {
  it.each([3, 99])("仅应用到服务端确定的章节和上下文行（行号 %s）", async (lineNo) => {
    const pending = await submit({ lineNo });
    const response = await review(pending.id);
    const result = await response.json() as { document: DocumentEnvelope; suggestion: Suggestion };
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result.document.content.content[1]).toMatchObject(p("target typo"));
    expect(result.document.content.content[3]).toMatchObject(p("other typo"));
    expect(result.document.content.content[4]).toMatchObject(p("target fixed"));
    expect(result.document.revision).toBe(2);
    expect(await env.DB.prepare("SELECT revision FROM chapters WHERE id = 'chapter-0' AND document_id = ?").bind(otherId).first()).toMatchObject({ revision: 1 });
  });

  it.each([
    [{ lineText: "outdated typo" }, "typo", "SUGGESTION_SOURCE_NOT_FOUND"],
    [{ lineNo: 4, lineText: "duplicate typo typo" }, "typo", "SUGGESTION_SOURCE_AMBIGUOUS"],
    [{ chapterId: "", lineNo: 0, lineText: "" }, "typo", "SUGGESTION_SOURCE_AMBIGUOUS"],
    [{ chapterId: "", lineNo: 0, lineText: "" }, "missing", "SUGGESTION_SOURCE_NOT_FOUND"],
  ])("冲突 %j 时返回 409 且不提交", async (overrides, from, code) => {
    const pending = await submit(overrides, from);
    const response = await review(pending.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(await env.DB.prepare("SELECT status, reviewer_id FROM suggestions WHERE id = ?").bind(pending.id).first()).toEqual({ status: "pending", reviewer_id: null });
    expect(await env.DB.prepare("SELECT current_revision FROM documents WHERE id = ?").bind(documentId).first()).toEqual({ current_revision: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM suggestion_review_guards WHERE suggestion_id = ?").bind(pending.id).first()).toEqual({ count: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM document_mutations WHERE document_id = ?").bind(documentId).first()).toEqual({ count: 0 });
  });

  it("允许旧版建议唯一匹配替换及删除全部匹配文本", async () => {
    const pending = await submit({ chapterId: "", lineNo: 0, lineText: "" }, "unique source", "");
    const response = await review(pending.id);
    expect(response.status).toBe(200);
    const result = await response.json() as { document: DocumentEnvelope };
    expect(result.document.content.content[6]!.content ?? []).toEqual([]);
  });

  it("章节移除后不降级为全局搜索", async () => {
    const pending = await submit({}, "unique source");
    await env.DB.prepare("UPDATE suggestions SET chapter_id = NULL WHERE id = ?").bind(pending.id).run();
    const response = await review(pending.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "SUGGESTION_SOURCE_NOT_FOUND" } });
  });

  it.each([false, true])("拒绝文档快照中不存在的独立章节内容（空壳 %s）", async (shell) => {
    if (shell) await env.DB.prepare("UPDATE document_revisions SET content_json = ? WHERE document_id = ?").bind(JSON.stringify({ type: "doc", content: [p("empty shell")] }), documentId).run();
    await env.DB.prepare("UPDATE chapters SET content_json = ? WHERE document_id = ? AND id = 'chapter-0'").bind(JSON.stringify({ type: "doc", content: [p("target typo")] }), documentId).run();
    const pending = await submit();
    const response = await review(pending.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "SUGGESTION_SOURCE_NOT_FOUND" } });
    expect(await env.DB.prepare("SELECT current_revision FROM documents WHERE id = ?").bind(documentId).first()).toEqual({ current_revision: 1 });
  });
});
