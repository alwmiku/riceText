import type { Editor } from "@tiptap/react";

export const toolbarColors = [
  "#20272c",
  "#197c73",
  "#b66a0a",
  "#b63434",
  "#6b4bb5",
];

export function dispatchToolbarInsert(editor: Editor, tool: string) {
  document.dispatchEvent(
    new CustomEvent("ricetext:context-insert", {
      detail: { editor, tool },
    }),
  );
}
