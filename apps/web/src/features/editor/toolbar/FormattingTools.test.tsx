import { Editor } from "@tiptap/core";
import { editorExtensions, getFormatPainterState } from "@ricetext/editor-core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useEditorSelectionState } from "../hooks/useEditorSelectionState";
import { clearFormatting } from "../editor-actions";
import { FormatPainterButton } from "./FormattingTools";

let editor: Editor;
afterEach(() => editor?.destroy());
function Painter() {
  useEditorSelectionState(editor);
  return <FormatPainterButton editor={editor} />;
}

it("locks on the actual two-click/double-click sequence and exits on another click", () => {
  editor = new Editor({
    extensions: editorExtensions(),
    content: "<p><strong>source</strong> target</p>",
  });
  editor.commands.setTextSelection(2);
  render(<Painter />);
  const button = screen.getByRole("button", { name: "格式刷" });
  fireEvent.click(button, { detail: 1 });
  fireEvent.click(button, { detail: 2 });
  fireEvent.doubleClick(button, { detail: 2 });
  expect(getFormatPainterState(editor).mode).toBe("continuous");
  expect(button).toHaveAttribute("aria-pressed", "true");
  act(() => editor.commands.setTextSelection({ from: 8, to: 14 }));
  act(() => editor.commands.applyFormatPainter());
  expect(editor.getHTML()).toContain("<strong>target</strong>");
  fireEvent.click(button, { detail: 1 });
  expect(getFormatPainterState(editor).mode).toBe("off");
});

it("clears indentation along with text and heading formatting", () => {
  editor = new Editor({
    extensions: editorExtensions(),
    content:
      '<h2 style="text-indent: 2em; margin-left: 4em"><strong>title</strong></h2><p>end</p>',
  });
  editor.commands.setTextSelection({ from: 1, to: 6 });
  clearFormatting(editor);
  expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
  expect(editor.state.doc.firstChild?.attrs).toMatchObject({
    firstLineIndent: 0,
    leftIndent: 0,
  });
  expect(editor.state.doc.firstChild?.firstChild?.marks).toHaveLength(0);
});
