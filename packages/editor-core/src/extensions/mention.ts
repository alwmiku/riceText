import { Node } from "@tiptap/core";

import { sanitizeUrl } from "../sanitize.js";

/** Tiptap inline atom for resolved and unresolved user mentions. */
export const Mention = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  marks: "_",
  addAttributes() {
    return {
      userId: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-user-id")?.slice(0, 128) ?? null,
      },
      name: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-name")?.slice(0, 100) ?? "",
      },
      resolved: {
        default: false,
        parseHTML: (element) =>
          element.getAttribute("data-resolved") === "true",
      },
      avatarUrl: {
        default: null,
        parseHTML: (element) =>
          sanitizeUrl(element.getAttribute("data-avatar-url"), "image"),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-node-type="mention"]' }];
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        class: `rt-mention ${node.attrs.resolved === true ? "rt-mention--resolved" : "rt-mention--unresolved"}`,
        "data-node-type": "mention",
        "data-user-id": node.attrs.userId ? String(node.attrs.userId) : "",
        "data-name": String(node.attrs.name),
        "data-resolved": node.attrs.resolved === true ? "true" : "false",
        "data-avatar-url": sanitizeUrl(node.attrs.avatarUrl, "image") ?? "",
        contenteditable: "false",
      },
      `@${String(node.attrs.name)}`,
    ];
  },
  addCommands() {
    return {
      insertMention:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
