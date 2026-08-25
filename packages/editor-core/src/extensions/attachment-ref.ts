import { Node } from "@tiptap/core";
import { attachmentRefNodeSpec } from "@ricetext/document-core";

/** 引用单独持久化的可下载文件的 Tiptap 原子节点（规格来自 document-core）。 */
export const AttachmentRef = Node.create({
  ...attachmentRefNodeSpec,
  addCommands() {
    return {
      insertAttachmentRef:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
