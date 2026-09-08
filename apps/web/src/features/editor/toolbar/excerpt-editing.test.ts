import { Editor } from "@tiptap/core";
import { editorExtensions } from "@ricetext/editor-core";
import { afterEach, describe, expect, it } from "vitest";
import { getExcerptEditTarget, updateExcerptMetadata } from "./excerpt-editing";

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()); });
function createEditor(variant = "qidian") {
  const editor = new Editor({ extensions: editorExtensions(), content: {
    type: "doc", content: [{ type: "novelExcerpt", attrs: { bookTitle: "Book", variant, readerTime: "22:05", batteryLevel: 0, pageLabel: "88/100", progressLabel: "88%", headerLabel: "Custom" }, content: [
      { type: "paragraph", content: [{ type: "text", text: "Bold", marks: [{ type: "bold" }] }] },
      { type: "paragraph", content: [{ type: "text", text: "Link", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }] },
    ] }, { type: "paragraph", content: [{ type: "text", text: "Outside" }] }],
  } });
  editors.push(editor);
  return editor;
}

describe("excerpt metadata editing", () => {
  it("finds an excerpt from a nested text cursor and preserves rich children through undo and redo", () => {
    const editor = createEditor();
    editor.commands.setTextSelection(3);
    const target = getExcerptEditTarget(editor)!;
    expect(target.initial.bookTitle).toBe("Book");
    expect(target.initial.variant).toBe("qidian");
    expect(target.initial).toMatchObject({ readerTime: "22:05", batteryLevel: "0", pageLabel: "88/100", progressLabel: "88%", headerLabel: "Custom" });
    const original = editor.getJSON();
    const content = original.content![0]!.content;
    // A dialog can move focus/selection; the captured target remains authoritative.
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    expect(updateExcerptMetadata(editor, target, { bookTitle: "Changed", variant: "qidian" })).toBe(true);
    const updated = editor.getJSON();
    expect(updated.content![0]!.content).toEqual(content);
    expect(updated.content![0]!.attrs).toMatchObject({ bookTitle: "Changed", variant: "qidian", readerTime: "22:05", pageLabel: "88/100", progressLabel: "88%" });
    expect(updated.content).toHaveLength(2);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(original);
    expect(editor.commands.redo()).toBe(true);
    expect(editor.getJSON()).toEqual(updated);
  });

  it("normalizes historical variants when reading and saving metadata without replacing content", () => {
    const editor = createEditor("forum-evidence");
    editor.commands.setNodeSelection(0);
    const target = getExcerptEditTarget(editor)!;
    expect(target.initial.variant).toBe("fanqie");
    const body = editor.getJSON().content![0]!.content;
    expect(updateExcerptMetadata(editor, target, { author: "Updated" })).toBe(true);
    expect(editor.getJSON().content![0]!.attrs).toMatchObject({ variant: "fanqie", bookTitle: "Book", author: "Updated", readerTime: "22:05" });
    expect(editor.getJSON().content![0]!.content).toEqual(body);
  });

  it("recognizes a selected excerpt and ignores cursors outside it", () => {
    const editor = createEditor();
    editor.commands.setNodeSelection(0);
    expect(getExcerptEditTarget(editor)?.pos).toBe(0);
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    expect(getExcerptEditTarget(editor)).toBeNull();
    editor.commands.setTextSelection({ from: 3, to: editor.state.doc.content.size - 2 });
    expect(getExcerptEditTarget(editor)).toBeNull();
  });

  it("refuses stale targets instead of replacing changed content", () => {
    const editor = createEditor();
    editor.commands.setTextSelection(3);
    const target = getExcerptEditTarget(editor)!;
    editor.commands.insertContent("new");
    const current = editor.getJSON();
    expect(updateExcerptMetadata(editor, target, { bookTitle: "Wrong" })).toBe(false);
    expect(editor.getJSON()).toEqual(current);
  });
});
