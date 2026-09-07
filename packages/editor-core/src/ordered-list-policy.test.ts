import { Editor, getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { createDocumentSchema, validateDocument } from "@ricetext/document-core";
import { editorExtensions } from "./extensions.js";

describe("ordered list document policy", () => {
  it("keeps the ordered-list schema attributes covered by the write policy", () => {
    const schema = getSchema(editorExtensions());
    const attrs = Object.fromEntries(Object.entries(schema.nodes.orderedList!.spec.attrs ?? {}).map(([name, spec]) => [name, spec.default]));
    const result = validateDocument({ type: "doc", content: [{ type: "orderedList", attrs, content: [{ type: "listItem", content: [{ type: "paragraph" }] }] }] });
    expect(result.issues).toEqual([]);
    expect(Object.keys(result.document.content![0]!.attrs!).sort()).toEqual(Object.keys(attrs).sort());
  });
  it("accepts the raw real-editor ordered-list JSON used by first publish", () => {
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

  it.each(["1", "a", "A", "i", "I"])("preserves valid HTML numbering type %s", (type) => {
    const editor = new Editor({ extensions: editorExtensions(), content: '<ol start="3" type="' + type + '"><li><p>Item</p></li></ol>' });
    try {
      const json = editor.getJSON();
      const result = validateDocument(json);
      expect(result.valid).toBe(true);
      expect(result.document.content?.[0]?.attrs).toEqual({ start: 3, type });
      if (type !== "1") expect(editor.getHTML()).toContain('type="' + type + '"');
      const restored = new Editor({ extensions: editorExtensions(), content: editor.getHTML() });
      // Upstream omits explicit decimal type="1" from HTML, equivalent to null.
      const expected = structuredClone(json);
      if (type === "1") expected.content![0]!.attrs!.type = null;
      expect(restored.getJSON()).toEqual(expected);
      restored.destroy();
    } finally { editor.destroy(); }
  });

  it("accepts ordered lists nested in a novel excerpt and preserves legacy lists", () => {
    const editor = new Editor({ extensions: editorExtensions(), content: '<aside data-node-type="novel-excerpt" data-variant="qidian"><ol><li><p>Nested excerpt list</p></li></ol></aside>' });
    try {
      expect(validateDocument(editor.getJSON()).valid).toBe(true);
      const legacy = validateDocument({ type: "doc", content: [{ type: "orderedList", attrs: { start: 4 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Legacy" }] }] }] }] });
      expect(legacy.valid).toBe(true);
      expect(legacy.document.content?.[0]?.attrs).toEqual({ start: 4, type: null });
    } finally { editor.destroy(); }
  });

  it.each(["evil", "", 1, {}, { toString: {} }, ["a"]])("rejects invalid ordered list type %j", (type) => {
    const result = validateDocument({ type: "doc", content: [{ type: "orderedList", attrs: { start: 1, type }, content: [{ type: "listItem", content: [{ type: "paragraph" }] }] }] });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({ code: "invalid-attribute", path: "$.content[0].attrs.type", message: "Ordered list type must be null, 1, a, A, i, or I." });
  });

  it("still rejects type attributes on unrelated nodes even when null", () => {
    const result = validateDocument({ type: "doc", content: [{ type: "paragraph", attrs: { type: null }, content: [{ type: "text", text: "Text" }] }] });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({ code: "unknown-attribute", path: "$.content[0].attrs.type", message: "Attribute type is not allowed and was removed." });
  });
});
