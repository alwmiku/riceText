import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { pollRefNodeSpec } from "@ricetext/document-core";

import { PollEditorView } from "../poll-node-view.js";

/** 引用服务端数据填充（hydrated）投票的 Tiptap 原子节点（规格来自 document-core）。 */
export const PollRef = Node.create({
  ...pollRefNodeSpec,
  addCommands() {
    return {
      insertPollRef:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(PollEditorView);
  },
});
