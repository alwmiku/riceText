import { Node } from "@tiptap/core";
import { richImageNodeSpec } from "@ricetext/document-core";

/** 不包含编辑器 React NodeView 的规范持久化富图片节点。 */
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
