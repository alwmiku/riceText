import type { TiptapDocument, TiptapNode } from "./schemas.js";

/** Depth-first traversal for Tiptap documents shared by server-side document flows. */
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
