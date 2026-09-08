import { Editor, type JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { createDocumentExtensions, createDocumentSchema, parseDocumentJson, stringifyDocument, validateDocument } from "@ricetext/document-core";
import { editorExtensions, schemaExtensions } from "./extensions/index.js";

function roundTrip(editor: Editor) {
  const validated = validateDocument(editor.getJSON());
  expect(validated.issues).toEqual([]);
  const read = parseDocumentJson(stringifyDocument(validated.document));
  expect(read).toEqual(validated);
  const persisted = createDocumentSchema().nodeFromJSON(read.document);
  expect(() => persisted.check()).not.toThrow();
  const restored = new Editor({ extensions: editorExtensions(), content: read.document });
  try {
    expect(restored.getJSON()).toEqual(persisted.toJSON());
    // 净化移除空样式后可能留下相邻文本；PM 重载会合并，往返按其规范形式比较。
    const canonical = validateDocument(persisted.toJSON());
    expect(canonical.issues).toEqual([]);
    expect(validateDocument(restored.getJSON())).toEqual(canonical);
    expect(parseDocumentJson(stringifyDocument(restored.getJSON()))).toEqual(canonical);
  } finally {
    restored.destroy();
  }
  return read.document;
}

describe("schema 持久化往返", () => {
  it("持久化实际格式命令、标题元数据和列表默认值", () => {
    const editor = new Editor({ extensions: editorExtensions(), content: "<p>Formatted text</p>" });
    try {
      expect(editor.chain().selectAll().setHeading({ level: 2 }).setTextAlign("center").setColor("#197c73").setFontFamily("Noto Serif SC").setFontSize("18px").setLink({ href: "https://example.com/book" }).run()).toBe(true);
      expect(editor.commands.updateAttributes("heading", { chapterStart: true })).toBe(true);
      expect(editor.commands.adjustIndent("firstLineIndent", 2)).toBe(true);
      const heading = roundTrip(editor).content![0]!;
      expect(heading.attrs).toEqual({ textAlign: "center", chapterStart: true, firstLineIndent: 2, leftIndent: 0, level: 2 });
      expect(heading.content![0]!.marks).toContainEqual({ type: "textStyle", attrs: { color: "#197c73", fontFamily: "Noto Serif SC", fontSize: "18px" } });
      expect(editor.chain().selectAll().setParagraph().toggleOrderedList().run()).toBe(true);
      expect(roundTrip(editor).content![0]!.attrs).toEqual({ start: 1, type: null });
    } finally { editor.destroy(); }
  });

  it.each([createDocumentExtensions, schemaExtensions, editorExtensions])("所有工厂使用相同的安全 HTML 解析规则", (extensions) => {
    const editor = new Editor({ extensions: extensions(), content: '<p><span style="font-family: Georgia; font-size: 15px; color: rgba(1, 2, 3, 0.5)">Rejected</span> <span style="font-family: Noto Serif SC; font-size: 18px; color: #197c73">Allowed</span></p>' });
    try {
      const doc = roundTrip(editor);
      expect(doc.content![0]!.content!.map((node) => node.text ?? "").join("")).toBe("Rejected Allowed");
      expect(doc.content![0]!.content![0]!.marks).toBeUndefined();
      expect(doc.content![0]!.content!.at(-1)!.marks).toEqual([{ type: "textStyle", attrs: { color: "rgb(25, 124, 115)", fontFamily: "Noto Serif SC", fontSize: "18px" } }]);
    } finally { editor.destroy(); }
  });

  it("恢复旧版省略的默认值，并保留列表编号和摘录元数据", () => {
    const legacy: JSONContent = { type: "doc", content: [
      { type: "heading", content: [{ type: "text", text: "Legacy heading" }] },
      { type: "orderedList", attrs: { start: 4 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "List" }] }] }] },
      { type: "novelExcerpt", attrs: { bookTitle: "Book" }, content: [{ type: "paragraph" }] },
      { type: "longTextBlock", attrs: { chapterId: "c1", text: "Legacy text" } },
      { type: "paragraph", content: [{ type: "text", text: "Link", marks: [{ type: "link", attrs: { href: "https://example.com/" } }, { type: "textStyle", attrs: { color: "#197c73" } }] }] },
    ] };
    const read = parseDocumentJson(JSON.stringify(legacy));
    expect(read.issues).toEqual([]);
    expect(read.document.content![0]!.attrs).toEqual({ textAlign: "left", chapterStart: false, firstLineIndent: 0, leftIndent: 0, level: 2 });
    expect(read.document.content![1]!.attrs).toEqual({ start: 4, type: null });
    expect(read.document.content![2]!.attrs).toMatchObject({ bookTitle: "Book", variant: "fanqie", readerTime: "", batteryLevel: 100, pageLabel: "1/1" });
    expect(read.document.content![3]!.attrs).toEqual({ chapterId: "c1", title: "", volumeTitle: "", text: "Legacy text", order: 0, start: null, end: null });
    const editor = new Editor({ extensions: editorExtensions(), content: read.document });
    try { expect(roundTrip(editor)).toEqual(read.document); } finally { editor.destroy(); }
  });


});
