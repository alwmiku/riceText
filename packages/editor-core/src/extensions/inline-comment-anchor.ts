import { Node } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { inlineCommentAnchorNodeSpec } from "@ricetext/document-core";

import { countInlineCommentAnchors } from "./helpers.js";

/** 用于段落起始或段落末尾评论计数器的 Tiptap 节点（规格来自 document-core）。 */
export const InlineCommentAnchor = Node.create({
  ...inlineCommentAnchorNodeSpec,
  addCommands() {
    return {
      insertInlineCommentAnchor:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("inlineCommentAnchorProtected"),
        filterTransaction: (transaction, state) => {
          if (!transaction.docChanged) return true;
          // 宿主受控导入（回滚/远端装载）会整篇替换文档，属显式操作，
          // 不受“防止用户编辑误删锚点”的保护限制。
          if (transaction.getMeta("hostContentReplace")) return true;
          const before = countInlineCommentAnchors(state.doc);
          const after = countInlineCommentAnchors(transaction.doc);
          return after >= before;
        },
      }),
    ];
  },
});
