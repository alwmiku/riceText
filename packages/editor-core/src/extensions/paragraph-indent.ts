import {
  MAX_PARAGRAPH_INDENT,
  ParagraphIndentAttributes,
  type IndentAttribute,
} from "@ricetext/document-core";
import { closeHistory } from "@tiptap/pm/history";
import { AllSelection, TextSelection } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphIndent: {
      adjustIndent: (
        attribute: IndentAttribute,
        delta: -2 | 2,
        wholeDocument?: boolean,
      ) => ReturnType;
    };
  }
}

export const ParagraphIndent = ParagraphIndentAttributes.extend({
  addCommands() {
    return {
      adjustIndent:
        (attribute, delta, wholeDocument = false) =>
        ({ editor, tr, dispatch }) => {
          if (
            !editor.isEditable ||
            !["firstLineIndent", "leftIndent"].includes(attribute) ||
            (delta !== -2 && delta !== 2)
          )
            return false;
          if (
            !wholeDocument &&
            !(tr.selection instanceof TextSelection) &&
            !(tr.selection instanceof AllSelection)
          )
            return false;
          const { from, to } = wholeDocument
            ? { from: 0, to: tr.doc.content.size }
            : tr.selection;
          let changed = false;
          tr.doc.nodesBetween(from, to, (node, pos) => {
            if (!["paragraph", "heading"].includes(node.type.name)) return;
            const next = Math.max(
              0,
              Math.min(
                MAX_PARAGRAPH_INDENT,
                (node.attrs[attribute] as number) + delta,
              ),
            );
            if (next === node.attrs[attribute]) return;
            changed = true;
            if (dispatch)
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                [attribute]: next,
              });
          });
          if (changed && dispatch) closeHistory(tr);
          return changed;
        },
    };
  },
});
