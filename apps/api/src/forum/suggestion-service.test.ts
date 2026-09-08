import type { DatabaseSync } from "node:sqlite";
import type { TiptapDocument } from "@ricetext/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../db.js";
import { DocumentService } from "../document-service.js";
import { SuggestionService } from "./suggestion-service.js";

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const h = (text: string) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
const content: TiptapDocument = { type: "doc", content: [h("First"), p("target typo"), h("Second"), p("other typo"), p("target typo"), p("duplicate typo typo"), p("unique source")] };
const author = { id: "author", role: "author" as const, name: "Author", bio: "", isFriend: true };
const location = { chapterId: "chapter-0", chapterTitle: "Untrusted title", lineNo: 3, lineText: "target typo" };

describe("SuggestionService 安全定位", () => {
  let db: DatabaseSync;
  let documents: DocumentService;
  let suggestions: SuggestionService;
  beforeEach(() => {
    db = createDatabase({ path: ":memory:", seed: false });
    db.prepare("INSERT INTO users(id, name, role, is_friend, bio) VALUES ('author', 'Author', 'author', 1, '')").run();
    for (const id of ["article-a", "article-b"]) {
      db.prepare("INSERT INTO documents(id, title, schema_version, current_revision, created_by, created_at, updated_at) VALUES (?, ?, 1, 1, 'author', ?, ?)").run(id, id, new Date(0).toISOString(), new Date(0).toISOString());
      db.prepare("INSERT INTO document_revisions(document_id, revision, schema_version, content_json, author_id, operation, created_at) VALUES (?, 1, 1, ?, 'author', 'seed', ?)").run(id, JSON.stringify(content), new Date(0).toISOString());
    }
    // 刻意让同一 ID 在两篇文档中对应不同位置。
    for (const [id, documentId, order] of [["first", "article-a", 0], ["chapter-0", "article-a", 1], ["chapter-0", "article-b", 0]] as const) {
      db.prepare("INSERT INTO chapters(id, document_id, title, sort_order, revision, updated_at) VALUES (?, ?, ?, ?, 1, ?)").run(id, documentId, id, order, new Date(0).toISOString());
    }
    documents = new DocumentService(db);
    suggestions = new SuggestionService(db, documents);
  });
  afterEach(() => db.close());
  const submit = (overrides = {}, from = "typo", to = "fixed") => suggestions.createSuggestion("article-a", from, to, "", author, { ...location, ...overrides });
  const review = (id: string) => suggestions.reviewSuggestion(id, "approve", 1, author);

  it.each([3, 99])("仅应用到服务端确定的章节和上下文行（行号 %s）", (lineNo) => {
    const result = review(submit({ lineNo }).id);
    expect(result.document?.content.content[1]).toMatchObject(p("target typo"));
    expect(result.document?.content.content[3]).toMatchObject(p("other typo"));
    expect(result.document?.content.content[4]).toMatchObject(p("target fixed"));
    expect(result.document?.revision).toBe(2);
    expect(db.prepare("SELECT revision FROM chapters WHERE id = 'chapter-0' AND document_id = 'article-b'").get()).toMatchObject({ revision: 1 });
  });

  it.each([
    [{ lineText: "outdated typo" }, "typo", "SUGGESTION_SOURCE_NOT_FOUND"],
    [{ lineNo: 4, lineText: "duplicate typo typo" }, "typo", "SUGGESTION_SOURCE_AMBIGUOUS"],
    [{ chapterId: "", lineNo: 0, lineText: "" }, "typo", "SUGGESTION_SOURCE_AMBIGUOUS"],
    [{ chapterId: "", lineNo: 0, lineText: "" }, "missing", "SUGGESTION_SOURCE_NOT_FOUND"],
  ])("冲突 %j 时保持文档不变且建议仍待审核", (overrides, from, code) => {
    const pending = submit(overrides, from);
    const before = documents.get("article-a");
    expect(() => review(pending.id)).toThrow(expect.objectContaining({ status: 409, code }));
    expect(documents.get("article-a")).toEqual(before);
    expect(suggestions.suggestions("article-a", author)[0]).toMatchObject({ status: "pending", reviewerId: null });
    expect(db.prepare("SELECT COUNT(*) AS count FROM document_mutations").get()).toMatchObject({ count: 0 });
  });

  it("允许旧版建议唯一匹配替换及删除全部匹配文本", () => {
    const result = review(submit({ chapterId: "", lineNo: 0, lineText: "" }, "unique source", "").id);
    expect(result.document?.content.content[6]!.content ?? []).toEqual([]);
  });

  it("章节删除后不降级为旧版全局搜索", () => {
    const pending = submit({}, "unique source");
    db.prepare("UPDATE suggestions SET chapter_id = NULL WHERE id = ?").run(pending.id);
    expect(() => review(pending.id)).toThrow(expect.objectContaining({ status: 409, code: "SUGGESTION_SOURCE_NOT_FOUND" }));
  });

  it.each([false, true])("拒绝文档快照中不存在的独立章节内容（空壳 %s）", (shell) => {
    if (shell) db.prepare("UPDATE document_revisions SET content_json = ? WHERE document_id = 'article-a'").run(JSON.stringify({ type: "doc", content: [p("empty shell")] }));
    db.prepare("UPDATE chapters SET content_json = ? WHERE document_id = 'article-a' AND id = 'chapter-0'").run(JSON.stringify({ type: "doc", content: [p("target typo")] }));
    const pending = submit();
    expect(() => review(pending.id)).toThrow(expect.objectContaining({ status: 409, code: "SUGGESTION_SOURCE_NOT_FOUND" }));
    expect(documents.get("article-a").revision).toBe(1);
  });
});
