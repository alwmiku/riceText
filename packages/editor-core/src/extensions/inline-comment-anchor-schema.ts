import { Node } from "@tiptap/core";
import { inlineCommentAnchorNodeSpec } from "@ricetext/document-core";

/** 不包含编辑器事务保护的规范持久化行内评论锚点。 */
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
