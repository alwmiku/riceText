import { Node } from "@tiptap/core";
import { richImageNodeSpec } from "@ricetext/document-core";

/** Canonical persisted rich-image node without an editor React NodeView. */
export const RichImageSchema = Node.create({
  ...richImageNodeSpec,
  addCommands() {
    return {
      insertRichImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
