import { Node } from "@tiptap/core";
import { longTextBlockNodeSpec } from "@ricetext/document-core";

/** 不包含编辑器存储或 React NodeView 的规范持久化长文本块。 */
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
