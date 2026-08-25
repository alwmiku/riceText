import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** HTML 属性解析辅助函数统一来自 document-core。 */
export { parseInteger, parseJsonArray } from "@ricetext/document-core";

/** 统计 ProseMirror 文档中的内联评论锚点数量。 */
export function countInlineCommentAnchors(doc: ProseMirrorNode): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name === "inlineCommentAnchor") count += 1;
  });
  return count;
}
