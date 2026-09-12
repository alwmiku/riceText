import type { TiptapDocument, TiptapNode } from "@ricetext/contracts";
import { describe, expect, it } from "vitest";
import { applySuggestionText, type SuggestionLocation } from "./suggestions";
import { replaceFirstText } from "./index";

const p = (text: string): TiptapNode => ({ type: "paragraph", content: [{ type: "text", text }] });
/** 章节标题：H1 + chapterStart（H1 是唯一的分章层级）。 */
const h = (text: string, level = 1): TiptapNode => ({
  type: "heading",
  attrs: { level, ...(level === 1 ? { chapterStart: true } : {}) },
  content: [{ type: "text", text }],
});
const doc = (...content: TiptapNode[]): TiptapDocument => ({ type: "doc", content });
const location: SuggestionLocation = { chapterId: "real-chapter-id", chapterOrder: 1, lineNo: 3, lineText: "target typo" };
const legacy: SuggestionLocation = { chapterId: "", chapterOrder: null, lineNo: 0, lineText: "" };
const current = doc(h("First"), p("target typo"), h("Second"), p("other typo"), p("target typo"));
const apply = (content = current, overrides: Partial<SuggestionLocation> = {}, from = "typo", to = "fixed") => applySuggestionText(content, from, to, { ...location, ...overrides });
const conflict = (run: () => unknown, code: string) => expect(run).toThrow(expect.objectContaining({ status: 409, code }));

describe("单条纠错建议定位", () => {
  it("保留旧版公开导出，同时要求唯一匹配并报告 409 冲突", () => {
    const compatible: (content: TiptapDocument, fromText: string, toText: string) => TiptapDocument | null = replaceFirstText;
    const source = doc(p("unique typo"));
    expect(compatible(source, "typo", "fixed")).toEqual(doc(p("unique fixed")));
    expect(source).toEqual(doc(p("unique typo")));
    conflict(() => compatible(current, "typo", "fixed"), "SUGGESTION_SOURCE_AMBIGUOUS");
    conflict(() => compatible(source, "missing", "fixed"), "SUGGESTION_SOURCE_NOT_FOUND");
  });
  it("使用服务端章节顺序和行上下文，且不修改原文", () => {
    const before = structuredClone(current);
    expect(apply()).toEqual(doc(h("First"), p("target typo"), h("Second"), p("other typo"), p("target fixed")));
    expect(current).toEqual(before);
  });
  it("仅在所属章节内重新定位发生偏移的行", () => {
    expect(apply(current, { lineNo: 99 })).toEqual(apply());
  });
  it("通过行号和精确上下文区分相同文本行", () => {
    const result = apply(doc(h("First"), h("Second"), p("target typo"), p("target typo")));
    expect(result.content[2]).toEqual(p("target typo"));
    expect(result.content[3]).toEqual(p("target fixed"));
  });
  it("行号发生偏移时拒绝重复上下文", () => {
    conflict(() => apply(doc(h("First"), h("Second"), p("target typo"), p("target typo")), { lineNo: 99 }), "SUGGESTION_SOURCE_AMBIGUOUS");
  });
  it("上下文变化后不回退到其他行或章节", () => {
    conflict(() => apply(current, { lineText: "outdated typo" }), "SUGGESTION_SOURCE_NOT_FOUND");
    conflict(() => apply(doc(h("First"), p("target typo"), h("Second"), p("changed"))), "SUGGESTION_SOURCE_NOT_FOUND");
  });
  it.each([null, -1, 9, 0.5])("拒绝未解析或非法的服务端顺序 %s", (chapterOrder) => {
    conflict(() => apply(current, { chapterOrder }), "SUGGESTION_SOURCE_NOT_FOUND");
  });
  it("不将已删除章节或孤立行号重新解释为旧版无定位建议", () => {
    conflict(() => apply(current, { chapterId: "" }), "SUGGESTION_SOURCE_NOT_FOUND");
    conflict(() => apply(current, { lineText: "" }), "SUGGESTION_SOURCE_NOT_FOUND");
  });
  it("无定位建议必须在全文中唯一匹配", () => {
    conflict(() => applySuggestionText(current, "typo", "fixed", legacy), "SUGGESTION_SOURCE_AMBIGUOUS");
    expect(applySuggestionText(doc(p("unique typo")), "typo", "fixed", legacy)).toEqual(doc(p("unique fixed")));
    conflict(() => applySuggestionText(current, "missing", "fixed", legacy), "SUGGESTION_SOURCE_NOT_FOUND");
  });
  it("旧版建议即使仅保留章节提示也必须在全文中唯一匹配", () => {
    conflict(() => apply(current, { lineNo: 0, lineText: "" }), "SUGGESTION_SOURCE_AMBIGUOUS");
    conflict(() => apply(doc(h("First"), p("only typo"), h("Second"), p("other")), { lineNo: 0, lineText: "" }), "SUGGESTION_SOURCE_NOT_FOUND");
  });
  it("拒绝所选行内的重复及重叠匹配", () => {
    conflict(() => apply(doc(p("typo typo")), { chapterOrder: 0, lineNo: 1, lineText: "typo typo" }), "SUGGESTION_SOURCE_AMBIGUOUS");
    conflict(() => apply(doc(p("aaa")), { chapterOrder: 0, lineNo: 1, lineText: "aaa" }, "aa"), "SUGGESTION_SOURCE_AMBIGUOUS");
  });
  it("跨相邻标记替换，并按字面量处理替换文本", () => {
    const content = doc({ type: "paragraph", content: [
      { type: "text", text: "pre ty", marks: [{ type: "bold" }] },
      { type: "text", text: "po post", marks: [{ type: "italic" }] },
    ] });
    expect(applySuggestionText(content, "typo", "$&", legacy).content[0]!.content).toEqual([
      { type: "text", text: "pre $&", marks: [{ type: "bold" }] },
      { type: "text", text: " post", marks: [{ type: "italic" }] },
    ]);
  });
  it("删除整个文本节点，且不留下非法空文本", () => {
    expect(applySuggestionText(doc(p("typo")), "typo", "", legacy)).toEqual(doc({ type: "paragraph", content: [] }));
  });
  it("拒绝跨块和行内原子节点的匹配", () => {
    conflict(() => applySuggestionText(doc(p("ty"), p("po")), "typo", "fixed", legacy), "SUGGESTION_SOURCE_NOT_FOUND");
    const content = doc({ type: "paragraph", content: [{ type: "text", text: "ty" }, { type: "hardBreak" }, { type: "text", text: "po" }] });
    conflict(() => applySuggestionText(content, "typo", "fixed", legacy), "SUGGESTION_SOURCE_NOT_FOUND");
  });
  it("拒绝与文档快照不一致的独立章节正文", () => {
    conflict(() => apply(current, { chapterContent: doc(p("target typo")) }), "SUGGESTION_SOURCE_NOT_FOUND");
  });
});
