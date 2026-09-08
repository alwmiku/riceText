import type { TiptapNode } from "@ricetext/contracts";
import type { RichTextNode } from "./types";

/** 契约的可选字段允许显式 undefined；编辑器的可选字段要求省略对应键。 */
export function toEditorContent(node: TiptapNode): RichTextNode {
  return {
    type: node.type,
    ...(node.attrs !== undefined ? { attrs: node.attrs } : {}),
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(node.content !== undefined
      ? { content: node.content.map(toEditorContent) }
      : {}),
    ...(node.marks !== undefined
      ? {
          marks: node.marks.map((mark) => ({
            type: mark.type,
            ...(mark.attrs !== undefined ? { attrs: mark.attrs } : {}),
          })),
        }
      : {}),
  };
}
