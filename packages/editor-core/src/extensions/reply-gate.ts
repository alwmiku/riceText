import { Node } from "@tiptap/core";
import { replyGateNodeSpec } from "@ricetext/document-core";

/** 内容根据回复访问权限进行投射的 Tiptap 块节点（规格来自 document-core）。 */
export const ReplyGate = Node.create({
  ...replyGateNodeSpec,
  addCommands() {
    return {
      insertReplyGate:
        (attrs, content = [{ type: "paragraph" }]) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs, content }),
    };
  },
});
