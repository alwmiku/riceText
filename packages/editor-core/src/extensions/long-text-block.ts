import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { longTextBlockNodeSpec } from "@ricetext/document-core";

import { LongTextView } from "../long-text-node-view.js";

/** 用于长篇小说章节、带虚拟化 React 视图的 Tiptap 块节点（规格来自 document-core）。 */
export const LongTextBlock = Node.create({
  ...longTextBlockNodeSpec,
  addCommands() {
    return {
      insertLongTextBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
  addStorage() {
    return {
      /** 宿主注册的光标处切章处理器；未注册时节点视图走内置插入路径。 */
      onSplit: null as null | ((before: string, after: string) => void),
      /** 宿主注册的章节编辑回调：修改通过引用传回宿主，不直接改节点属性。 */
      onChapterEdit:
        null as null | ((chapterId: string, patch: { title?: string; text?: string }) => void),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(LongTextView);
  },
});
