import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLocalDocumentDraft,
  loadLocalDocumentDraft,
  saveLocalDocumentDraft,
} from "./local-document-draft-storage";

const key = (documentId: string) => `ricetext:draft:${documentId}`;

const draft = (documentId = "demo-post") => ({
  documentId,
  baseRevision: 3,
  content: { type: "doc", content: [{ type: "paragraph" }] } as never,
  savedAt: "2026-01-01T00:00:00.000Z",
});

beforeEach(() => {
  window.localStorage.clear();
});

describe("本地正文草稿", () => {
  it("保存后可原样读回，清草稿后读不到", () => {
    saveLocalDocumentDraft(draft());
    expect(loadLocalDocumentDraft("demo-post")).toEqual(draft());
    clearLocalDocumentDraft("demo-post");
    expect(loadLocalDocumentDraft("demo-post")).toBeNull();
  });

  it("不同文档互不覆盖，也不受其他 key 影响", () => {
    saveLocalDocumentDraft(draft("a"));
    saveLocalDocumentDraft(draft("b"));
    expect(loadLocalDocumentDraft("a")?.documentId).toBe("a");
    expect(loadLocalDocumentDraft("b")?.documentId).toBe("b");
    expect(loadLocalDocumentDraft("c")).toBeNull();
  });

  it("结构不完整的草稿一律忽略", () => {
    const cases: Record<string, unknown> = {
      "不是 JSON": "{ 坏掉的",
      "文档 ID 不匹配": { ...draft(), documentId: "其他文档" },
      "baseRevision 不是整数": { ...draft(), baseRevision: 1.5 },
      "savedAt 不是字符串": { ...draft(), savedAt: 12345 },
      "content 不是 doc": { ...draft(), content: { type: "paragraph" } },
      "content 缺失": { documentId: "demo-post", baseRevision: 1, savedAt: "x" },
    };
    for (const [label, value] of Object.entries(cases)) {
      window.localStorage.setItem(
        key("demo-post"),
        typeof value === "string" ? value : JSON.stringify(value),
      );
      expect(loadLocalDocumentDraft("demo-post"), label).toBeNull();
    }
  });
});
