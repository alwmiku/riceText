import { Editor } from "@tiptap/core";
import { editorExtensions, getFormatPainterState } from "@ricetext/editor-core";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useEditorSelectionState } from "../hooks/useEditorSelectionState";
import { clearFormatting } from "../editor-actions";
import { useState } from "react";
import { FormatPainterButton, IndentControls } from "./FormattingTools";

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
    content: '<h2 style="text-indent: 2em; margin-left: 4em"><strong>title</strong></h2><p>end</p>',
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

function IndentHarness() {
  useEditorSelectionState(editor);
  const [wholeDocument, setWholeDocument] = useState(false);
  return (
    <IndentControls
      editor={editor}
      wholeDocument={wholeDocument}
      onWholeDocumentChange={setWholeDocument}
    />
  );
}
function setupIndent() {
  editor = new Editor({
    extensions: editorExtensions(),
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "第一段" }] },
        {
          type: "paragraph",
          attrs: { textAlign: "right" },
          content: [{ type: "text", text: "第二段" }],
        },
      ],
    },
  });
  editor.commands.setTextSelection(1);
  render(<IndentHarness />);
}
const attributes = () => editor.state.doc.content.content.map((node) => node.attrs);

it("默认只改当前段落，选择本章范围本身不修改正文", () => {
  setupIndent();
  const range = screen.getByRole("group", { name: "缩进范围" });
  expect(within(range).getByRole("button", { name: "当前段落" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  act(() => fireEvent.click(screen.getByRole("button", { name: "增加首行缩进" })));
  expect(attributes().map((attrs) => attrs.firstLineIndent)).toEqual([2, 0]);
  const before = editor.getJSON();
  const selection = editor.state.selection.toJSON();
  fireEvent.click(within(range).getByRole("button", { name: "本章全部" }));
  expect(editor.getJSON()).toEqual(before);
  expect(editor.state.selection.toJSON()).toEqual(selection);
  expect(screen.getByText("调整本章全部段落的缩进")).toBeInTheDocument();
  act(() => fireEvent.click(screen.getByRole("button", { name: "增加整段缩进" })));
  expect(attributes().map((attrs) => attrs.leftIndent)).toEqual([2, 2]);
  expect(attributes().map((attrs) => attrs.textAlign)).toEqual([null, "right"]);
  expect(editor.state.doc.textContent).toBe("第一段第二段");
});

it("返回当前范围后只调整当前段落，并明确不影响列表与对齐", () => {
  setupIndent();
  const range = screen.getByRole("group", { name: "缩进范围" });
  fireEvent.click(within(range).getByRole("button", { name: "本章全部" }));
  fireEvent.click(within(range).getByRole("button", { name: "当前段落" }));
  act(() => fireEvent.click(screen.getByRole("button", { name: "增加整段缩进" })));
  expect(attributes().map((attrs) => attrs.leftIndent)).toEqual([2, 0]);
  expect(screen.getByText("每次增减 2 字，不影响列表和对齐")).toBeInTheDocument();
});
