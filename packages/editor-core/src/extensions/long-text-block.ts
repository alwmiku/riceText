import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { LongTextView } from "../long-text-node-view.js";
import { parseInteger } from "./helpers.js";

/** Tiptap block node for long novel chapters with a virtualized React view. */
export const LongTextBlock = Node.create({
  name: "longTextBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      chapterId: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-chapter-id")?.slice(0, 128) ?? "",
      },
      title: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-title")?.slice(0, 500) ?? "",
      },
      text: {
        default: "",
        parseHTML: (element) =>
          element.textContent?.slice(0, 100_000_000) ?? "",
      },
      order: {
        default: 0,
        parseHTML: (element) =>
          parseInteger(element.getAttribute("data-order"), 0, 0, 1_000_000),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'section[data-node-type="long-text-block"]' }];
  },
  renderHTML({ node }) {
    return [
      "section",
      {
        class: "rt-long-text",
        "data-node-type": "long-text-block",
        "data-chapter-id": String(node.attrs.chapterId ?? ""),
        "data-title": String(node.attrs.title ?? ""),
        "data-order": String(node.attrs.order ?? 0),
      },
      String(node.attrs.text ?? ""),
    ];
  },
  addCommands() {
    return {
      insertLongTextBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(LongTextView);
  },
});
