import { Node } from "@tiptap/core";
import { inlineCommentAnchorNodeSpec } from "@ricetext/document-core";

/** Canonical persisted inline-comment anchor without editor transaction protection. */
export const InlineCommentAnchorSchema = Node.create({
  ...inlineCommentAnchorNodeSpec,
  addCommands() {
    return {
      insertInlineCommentAnchor:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
