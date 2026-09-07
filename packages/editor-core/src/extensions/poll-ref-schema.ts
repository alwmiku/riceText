import { Node } from "@tiptap/core";
import { pollRefNodeSpec } from "@ricetext/document-core";

/** 不包含编辑器 React NodeView 的规范持久化投票引用。 */
export const PollRefSchema = Node.create({
  ...pollRefNodeSpec,
  addCommands() {
    return {
      insertPollRef:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
