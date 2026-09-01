import { Plugin, PluginKey } from "@tiptap/pm/state";

import { countInlineCommentAnchors } from "./helpers.js";
import { InlineCommentAnchorSchema } from "./inline-comment-anchor-schema.js";

/** Editable inline-comment anchor with protection against accidental deletion. */
export const InlineCommentAnchor = InlineCommentAnchorSchema.extend({
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("inlineCommentAnchorProtected"),
        filterTransaction: (transaction, state) => {
          if (!transaction.docChanged) return true;
          if (transaction.getMeta("hostContentReplace")) return true;
          const before = countInlineCommentAnchors(state.doc);
          const after = countInlineCommentAnchors(transaction.doc);
          return after >= before;
        },
      }),
    ];
  },
});
