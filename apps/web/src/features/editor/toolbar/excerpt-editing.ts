import type { Editor, JSONContent } from "@ricetext/editor-core";
import type { Node } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { emptyExcerptValues, type ExcerptValues } from "../dialogs/excerpt-values";

export interface ExcerptEditTarget {
  pos: number;
  node: Node;
  initial: ExcerptValues;
  content: JSONContent[];
}

export function getExcerptEditTarget(editor: Editor): ExcerptEditTarget | null {
  const { selection } = editor.state;
  let match: { pos: number; node: Node } | null = null;
  if (selection instanceof NodeSelection && selection.node.type.name === "novelExcerpt") {
    match = { pos: selection.from, node: selection.node };
  } else {
    for (let depth = selection.$from.depth; depth > 0; depth--) {
      const node = selection.$from.node(depth);
      if (node.type.name === "novelExcerpt" && selection.to <= selection.$from.end(depth)) {
        match = { pos: selection.$from.before(depth), node };
        break;
      }
    }
  }
  if (!match) return null;
  const initial = { ...emptyExcerptValues };
  for (const key of ["bookTitle", "chapterTitle", "author", "sourceUrl", "variant", "readerTime", "pageLabel", "progressLabel", "headerLabel"] as const) {
    if (typeof match.node.attrs[key] === "string") initial[key] = match.node.attrs[key];
  }
  if (typeof match.node.attrs.batteryLevel === "number") initial.batteryLevel = String(match.node.attrs.batteryLevel);
  return { ...match, initial, content: match.node.toJSON().content ?? [] };
}

export function updateExcerptMetadata(editor: Editor, target: ExcerptEditTarget, attrs: Record<string, unknown>): boolean {
  // Refuse stale targets instead of modifying another node after document changes.
  if (editor.state.doc.nodeAt(target.pos) !== target.node) return false;
  return editor.chain().focus().command(({ tr }) => {
    tr.setNodeMarkup(target.pos, undefined, { ...target.node.attrs, ...attrs });
    return true;
  }).run();
}
