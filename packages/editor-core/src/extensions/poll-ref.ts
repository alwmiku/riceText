import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { PollEditorView } from "../poll-node-view.js";
import { parseJsonArray } from "./helpers.js";

/** 引用服务端数据填充（hydrated）投票的 Tiptap 原子节点。 */
export const PollRef = Node.create({
  name: "pollRef",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      pollId: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-poll-id")?.slice(0, 128) ?? "",
      },
      question: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-question")?.slice(0, 500) ?? "",
      },
      multiple: {
        default: false,
        parseHTML: (element) =>
          element.getAttribute("data-multiple") === "true",
      },
      options: {
        default: [],
        parseHTML: (element) =>
          parseJsonArray(element.getAttribute("data-options")).slice(0, 100),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'section[data-node-type="poll-ref"]' }];
  },
  renderHTML({ node }) {
    return [
      "section",
      {
        class: "rt-poll",
        "data-node-type": "poll-ref",
        "data-poll-id": String(node.attrs.pollId),
        "data-question": String(node.attrs.question),
        "data-multiple": node.attrs.multiple === true ? "true" : "false",
        "data-options": JSON.stringify(node.attrs.options),
        contenteditable: "false",
      },
      String(node.attrs.question),
    ];
  },
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
