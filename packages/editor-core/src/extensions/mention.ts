import { Node } from "@tiptap/core";
import { mentionNodeSpec } from "@ricetext/document-core";

/** 用于已解析与未解析用户提及的 Tiptap 行内原子节点（规格来自 document-core）。 */
export const Mention = Node.create({
  ...mentionNodeSpec,
  addCommands() {
    return {
      insertMention:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
