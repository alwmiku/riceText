import { Editor, type JSONContent } from "@tiptap/core";
import {
  createDocumentSchema,
  applyStepsToDocument,
  sanitizeDocument,
  validateDocument,
  type StepJson,
} from "@ricetext/document-core";
import { afterEach, describe, expect, it } from "vitest";
import { editorExtensions } from "./index.js";
import { getFormatPainterState } from "./format-painter.js";

const editors: Editor[] = [];
function create(content: string | JSONContent) {
  const editor = new Editor({ extensions: editorExtensions(), content });
  editors.push(editor);
  return editor;
}
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

function select(editor: Editor, text: string, cursor = false) {
  let found = false;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || found) return;
    const index = node.text!.indexOf(text);
    if (index < 0) return;
    const from = pos + index;
    editor.commands.setTextSelection(
      cursor ? from + 1 : { from, to: from + text.length },
    );
    found = true;
  });
  expect(found).toBe(true);
}
function marks(editor: Editor, text: string) {
  let result: Record<string, unknown> = {};
  editor.state.doc.descendants((node) => {
    if (node.isText && node.text?.includes(text)) {
      result = Object.fromEntries(
        node.marks.map((mark) => [mark.type.name, { ...mark.attrs }]),
      );
    }
  });
  return result;
}
function indents(editor: Editor, key = "firstLineIndent") {
  const values: number[] = [];
  editor.state.doc.descendants((node) => {
    if (["paragraph", "heading"].includes(node.type.name))
      values.push(node.attrs[key]);
  });
  return values;
}

describe("paragraph indent", () => {
  it("adjusts current and selected paragraphs independently, with bounds and unchanged selection", () => {
    const editor = create(
      '<p>one</p><p style="text-indent: 4em">two</p><p>three</p>',
    );
    select(editor, "one", true);
    const selection = editor.state.selection.toJSON();
    expect(editor.commands.adjustIndent("firstLineIndent", 2)).toBe(true);
    expect(indents(editor)).toEqual([2, 4, 0]);
    expect(editor.state.selection.toJSON()).toEqual(selection);
    editor.commands.setTextSelection({ from: 1, to: 9 });
    editor.commands.adjustIndent("firstLineIndent", 2);
    expect(indents(editor)).toEqual([4, 6, 0]);
    editor.commands.selectAll();
    editor.commands.adjustIndent("leftIndent", 2);
    expect(indents(editor, "leftIndent")).toEqual([2, 2, 2]);
    for (let i = 0; i < 15; i++)
      editor.commands.adjustIndent("firstLineIndent", 2, true);
    expect(indents(editor)).toEqual([20, 20, 20]);
    expect(editor.can().adjustIndent("firstLineIndent", 2, true)).toBe(false);
    for (let i = 0; i < 15; i++)
      editor.commands.adjustIndent("firstLineIndent", -2, true);
    expect(indents(editor)).toEqual([0, 0, 0]);
  });

  it("includes headings, empty paragraphs and nested text blocks without indenting containers or code", () => {
    const editor = create(
      "<h2>title</h2><p></p><ul><li><p>list</p></li></ul><blockquote><p>quote</p></blockquote><pre><code>code</code></pre><p>end</p>",
    );
    editor.commands.adjustIndent("leftIndent", 2, true);
    expect(indents(editor, "leftIndent")).toEqual([2, 2, 2, 2, 2]);
    expect(editor.state.doc.child(4).attrs.leftIndent).toBeUndefined();
    expect(editor.state.doc.child(2).attrs.leftIndent).toBeUndefined();
    editor.commands.undo();
    expect(indents(editor, "leftIndent")).toEqual([0, 0, 0, 0, 0]);
    editor.commands.redo();
    expect(indents(editor, "leftIndent")).toEqual([2, 2, 2, 2, 2]);
  });

  it("inherits indentation when splitting a paragraph and supports attribute reset", () => {
    const editor = create(
      '<p style="text-indent: 2em; margin-left: 4em">hello</p>',
    );
    editor.commands.setTextSelection(3);
    editor.commands.splitBlock();
    expect(indents(editor)).toEqual([2, 2]);
    expect(indents(editor, "leftIndent")).toEqual([4, 4]);
    editor.commands.resetAttributes("paragraph", [
      "firstLineIndent",
      "leftIndent",
    ]);
    expect(indents(editor)).toEqual([2, 0]);
  });

  it("round-trips HTML and server JSON without losing indentation or normalization stability", () => {
    const editor = create(
      '<h2 style="text-indent: 2em; margin-left: 4em">heading</h2><p style="text-indent: 4em">body</p>',
    );
    const safe = sanitizeDocument(editor.getJSON());
    expect(validateDocument(safe).valid).toBe(true);
    expect(
      JSON.stringify(createDocumentSchema().nodeFromJSON(safe).toJSON()),
    ).toBe(JSON.stringify(safe));
    expect(create(editor.getHTML()).getJSON()).toEqual(editor.getJSON());
    const before = editor.getJSON();
    let steps: StepJson[] = [];
    editor.on("update", ({ transaction }) => {
      steps = transaction.steps.map((step) => step.toJSON());
    });
    editor.commands.adjustIndent("leftIndent", 2, true);
    expect(steps.length).toBeGreaterThan(0);
    const applied = applyStepsToDocument(createDocumentSchema(), before, steps);
    expect(applied).toEqual(editor.getJSON());
  });

  it("defaults old documents and rejects invalid indent attributes and HTML", () => {
    expect(indents(create("<p>old</p>"))).toEqual([0]);
    for (const value of [-2, 1, 22, 2.5, "2em", "url(javascript:x)"]) {
      const result = validateDocument({
        type: "doc",
        content: [{ type: "paragraph", attrs: { firstLineIndent: value } }],
      });
      expect(result.valid).toBe(false);
      expect(result.document.content?.[0]?.attrs?.firstLineIndent).toBe(0);
    }
    expect(
      indents(
        create(
          '<p style="text-indent: -2em">a</p><p style="text-indent: 10px">b</p>',
        ),
      ),
    ).toEqual([0, 0]);
  });
});

describe("format painter", () => {
  it("replaces all supported styles while preserving the target paragraph and link", () => {
    const editor = create(
      '<p><strong><u><span style="color: #ff0000; font-size: 18px">source</span></u></strong></p><p style="text-align: right; text-indent: 4em"><a href="https://example.com"><em><s><span style="font-family: serif; font-size: 24px">target</span></s></em></a></p>',
    );
    select(editor, "source", true);
    editor.commands.startFormatPainter();
    select(editor, "target");
    expect(editor.commands.applyFormatPainter()).toBe(true);
    const result = marks(editor, "target");
    expect(result).toMatchObject({
      bold: {},
      underline: {},
      textStyle: { fontSize: "18px", fontFamily: null },
      link: { href: "https://example.com" },
    });
    expect(result.italic).toBeUndefined();
    expect(result.strike).toBeUndefined();
    expect(editor.state.doc.lastChild?.attrs).toMatchObject({
      textAlign: "right",
      firstLineIndent: 4,
    });
    expect(getFormatPainterState(editor).mode).toBe("off");
    editor.commands.undo();
    expect(marks(editor, "target").italic).toEqual({});
    editor.commands.redo();
    expect(marks(editor, "target").bold).toEqual({});
  });

  it("keeps the source snapshot and isolates each continuous application in history", () => {
    const editor = create("<p><strong>source</strong></p><p>first second</p>");
    select(editor, "source");
    editor.commands.startFormatPainter("continuous");
    select(editor, "first");
    editor.commands.applyFormatPainter();
    select(editor, "second");
    editor.commands.applyFormatPainter();
    expect(marks(editor, "second").bold).toEqual({});
    expect(getFormatPainterState(editor).mode).toBe("continuous");
    editor.commands.undo();
    expect(marks(editor, "first").bold).toEqual({});
    expect(marks(editor, "second").bold).toBeUndefined();
    editor.commands.undo();
    expect(marks(editor, "first").bold).toBeUndefined();
  });

  it("copies the first text in a mixed selection and clears styles from a plain source", () => {
    const editor = create(
      "<p><strong>bold</strong><em>italic</em></p><p>plain</p><p><u>target</u></p>",
    );
    editor.commands.setTextSelection({ from: 1, to: 11 });
    editor.commands.startFormatPainter();
    select(editor, "target");
    editor.commands.applyFormatPainter();
    expect(marks(editor, "target")).toEqual({ bold: {} });
    select(editor, "plain");
    editor.commands.startFormatPainter();
    select(editor, "target");
    editor.commands.applyFormatPainter();
    expect(marks(editor, "target")).toEqual({});
  });

  it("preserves spoiler and code exclusions, atoms, and original text", () => {
    const editor = create(
      '<p><strong><u><span style="color: #ff0000">source</span></u></strong></p><p><span data-spoiler="true">secret</span><code>code</code>plain</p>',
    );
    const originalText = editor.getText();
    select(editor, "source");
    editor.commands.startFormatPainter();
    const start = editor.state.doc.firstChild!.nodeSize + 1;
    editor.commands.setTextSelection({
      from: start,
      to: editor.state.doc.content.size - 1,
    });
    editor.commands.applyFormatPainter();
    expect(marks(editor, "secret")).toEqual({ spoiler: {}, underline: {} });
    expect(marks(editor, "code")).toEqual({ code: {} });
    expect(marks(editor, "plain").bold).toEqual({});
    expect(editor.getText()).toBe(originalText);
    expect(validateDocument(editor.getJSON()).valid).toBe(true);
  });

  it("does not consume a single application on a cursor or on can(), and exits on replacement or read-only", async () => {
    const editor = create("<p><strong>source</strong> target</p>");
    select(editor, "source", true);
    const before = editor.getJSON();
    editor.commands.startFormatPainter();
    expect(editor.commands.applyFormatPainter()).toBe(false);
    expect(getFormatPainterState(editor).mode).toBe("once");
    select(editor, "target");
    expect(editor.can().applyFormatPainter()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
    expect(getFormatPainterState(editor).mode).toBe("once");
    editor.view.dispatch(editor.state.tr.setMeta("hostContentReplace", true));
    expect(getFormatPainterState(editor).mode).toBe("off");
    editor.commands.startFormatPainter("continuous");
    editor.setEditable(false, false);
    await Promise.resolve();
    expect(getFormatPainterState(editor).mode).toBe("off");
    expect(editor.commands.startFormatPainter()).toBe(false);
  });
});
