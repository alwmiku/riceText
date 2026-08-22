import { Node } from "@tiptap/core";

import { parseInteger } from "./helpers.js";

/** 引用单独持久化的可下载文件的 Tiptap 原子节点。 */
export const AttachmentRef = Node.create({
  name: "attachmentRef",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      attachmentId: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-attachment-id")?.slice(0, 128) ?? "",
      },
      name: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-name")?.slice(0, 300) ?? "",
      },
      mimeType: {
        default: "application/octet-stream",
        parseHTML: (element) =>
          element.getAttribute("data-mime-type")?.slice(0, 120) ??
          "application/octet-stream",
      },
      size: {
        default: 0,
        parseHTML: (element) =>
          parseInteger(
            element.getAttribute("data-size"),
            0,
            0,
            Number.MAX_SAFE_INTEGER,
          ),
      },
      priceCoins: {
        default: 0,
        parseHTML: (element) =>
          parseInteger(
            element.getAttribute("data-price-coins"),
            0,
            0,
            1_000_000_000,
          ),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-node-type="attachment-ref"]' }];
  },
  renderHTML({ node }) {
    return [
      "div",
      {
        class: "rt-attachment",
        "data-node-type": "attachment-ref",
        "data-attachment-id": String(node.attrs.attachmentId),
        "data-name": String(node.attrs.name),
        "data-mime-type": String(node.attrs.mimeType),
        "data-size": String(node.attrs.size),
        "data-price-coins": String(node.attrs.priceCoins),
        contenteditable: "false",
      },
      `${String(node.attrs.name)} · ${String(node.attrs.priceCoins)} 金币`,
    ];
  },
  addCommands() {
    return {
      insertAttachmentRef:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
