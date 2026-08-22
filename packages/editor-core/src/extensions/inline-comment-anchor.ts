import { Node } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import { countInlineCommentAnchors, parseInteger } from "./helpers.js";

/** Tiptap node for paragraph-start or paragraph-end comment counters. */
export const InlineCommentAnchor = Node.create({
  name: "inlineCommentAnchor",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      threadId: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-thread-id")?.slice(0, 128) ?? "",
      },
      count: {
        default: 0,
        parseHTML: (element) =>
          parseInteger(element.getAttribute("data-count"), 0, 0, 1_000_000),
      },
      placement: {
        default: "end",
        parseHTML: (element) =>
          element.getAttribute("data-placement") === "start" ? "start" : "end",
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-node-type="inline-comment-anchor"]' }];
  },
  renderHTML({ node }) {
    const empty = Number(node.attrs.count) <= 0;
    return [
      "span",
      {
        class: `rt-inline-comment-anchor${empty ? " rt-inline-comment-anchor--empty" : ""}`,
        "data-node-type": "inline-comment-anchor",
        "data-thread-id": String(node.attrs.threadId),
        "data-count": String(node.attrs.count),
        "data-placement": node.attrs.placement === "start" ? "start" : "end",
        contenteditable: "false",
      },
      empty ? "" : String(node.attrs.count),
    ];
  },
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
          const before = countInlineCommentAnchors(state.doc);
          const after = countInlineCommentAnchors(transaction.doc);
          return after >= before;
        },
      }),
    ];
  },
});
