import type { TiptapDocument, TiptapNode } from "./schemas.js";

/** 服务端文档处理流程共用的 Tiptap 文档深度优先遍历。 */
export function visitDocumentNodes(
  document: TiptapDocument,
  visitor: (node: TiptapNode) => void,
): void {
  const visit = (node: TiptapNode) => {
    visitor(node);
    for (const child of node.content ?? []) visit(child);
  };
  for (const node of document.content) visit(node);
}

export function collectInlineCommentAnchorIds(
  document: TiptapDocument,
): Set<string> {
  const result = new Set<string>();
  visitDocumentNodes(document, (node) => {
    if (
      node.type === "inlineCommentAnchor" &&
      typeof node.attrs?.threadId === "string"
    ) {
      result.add(node.attrs.threadId);
    }
  });
  return result;
}
