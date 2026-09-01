import { Node } from "@tiptap/core";
import { longTextBlockNodeSpec } from "@ricetext/document-core";

/** Canonical persisted long-text block without editor storage or a React NodeView. */
export const LongTextBlockSchema = Node.create({
  ...longTextBlockNodeSpec,
  addCommands() {
    return {
      insertLongTextBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
