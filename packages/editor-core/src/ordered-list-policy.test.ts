import { Editor, getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { createDocumentSchema, validateDocument } from "@ricetext/document-core";
import { editorExtensions } from "./extensions.js";

describe("有序列表文档规则", () => {
  it("确保有序列表 schema 属性均被写入规则覆盖", () => {
    const schema = getSchema(editorExtensions());
    const attrs = Object.fromEntries(Object.entries(schema.nodes.orderedList!.spec.attrs ?? {}).map(([name, spec]) => [name, spec.default]));
    const result = validateDocument({ type: "doc", content: [{ type: "orderedList", attrs, content: [{ type: "listItem", content: [{ type: "paragraph" }] }] }] });
    expect(result.issues).toEqual([]);
    expect(Object.keys(result.document.content![0]!.attrs!).sort()).toEqual(Object.keys(attrs).sort());
  });
  it("接受首次发布使用的真实编辑器原始有序列表 JSON", () => {
    const editor = new Editor({ extensions: editorExtensions(), content: "<ol><li><p>List text</p></li></ol>" });
    try {
      const json = editor.getJSON();
      expect(json.content?.[0]?.attrs).toEqual({ start: 1, type: null });
      const validation = validateDocument(json);
      expect(validation.issues, JSON.stringify({ json, issues: validation.issues })).toEqual([]);
      expect(validation.valid).toBe(true);
      expect(createDocumentSchema().nodeFromJSON(validation.document).toJSON()).toEqual(validation.document);
    } finally { editor.destroy(); }
  });

  it.each(["1", "a", "A", "i", "I"])("保留有效的 HTML 编号类型 %s", (type) => {
    const editor = new Editor({ extensions: editorExtensions(), content: '<ol start="3" type="' + type + '"><li><p>Item</p></li></ol>' });
    try {
      const json = editor.getJSON();
      const result = validateDocument(json);
      expect(result.valid).toBe(true);
      expect(result.document.content?.[0]?.attrs).toEqual({ start: 3, type });
      if (type !== "1") expect(editor.getHTML()).toContain('type="' + type + '"');
      const restored = new Editor({ extensions: editorExtensions(), content: editor.getHTML() });
      // 上游会在 HTML 中省略显式十进制编号 type="1"，其语义等同于 null。
      const expected = structuredClone(json);
      if (type === "1") expected.content![0]!.attrs!.type = null;
      expect(restored.getJSON()).toEqual(expected);
      restored.destroy();
    } finally { editor.destroy(); }
  });

  it("接受小说摘录内嵌套的有序列表，并保留旧版列表", () => {
    const editor = new Editor({ extensions: editorExtensions(), content: '<aside data-node-type="novel-excerpt" data-variant="qidian"><ol><li><p>Nested excerpt list</p></li></ol></aside>' });
    try {
      expect(validateDocument(editor.getJSON()).valid).toBe(true);
      const legacy = validateDocument({ type: "doc", content: [{ type: "orderedList", attrs: { start: 4 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Legacy" }] }] }] }] });
      expect(legacy.valid).toBe(true);
      expect(legacy.document.content?.[0]?.attrs).toEqual({ start: 4, type: null });
    } finally { editor.destroy(); }
  });

  it.each(["evil", "", 1, {}, { toString: {} }, ["a"]])("拒绝非法的有序列表类型 %j", (type) => {
    const result = validateDocument({ type: "doc", content: [{ type: "orderedList", attrs: { start: 1, type }, content: [{ type: "listItem", content: [{ type: "paragraph" }] }] }] });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({ code: "invalid-attribute", path: "$.content[0].attrs.type", message: "有序列表的 type 必须是 null、1、a、A、i 或 I。" });
  });

  it("仍拒绝无关节点上的 type 属性，即使其值为 null", () => {
    const result = validateDocument({ type: "doc", content: [{ type: "paragraph", attrs: { type: null }, content: [{ type: "text", text: "Text" }] }] });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({ code: "unknown-attribute", path: "$.content[0].attrs.type", message: "已移除不允许使用的属性 type。" });
  });
});
