import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { RichImageView } from "../rich-image-node-view.js";
import { sanitizeUrl } from "../sanitize.js";
import { parseInteger } from "./helpers.js";

/** 用于已上传图片与外部图片的 Tiptap 块节点。 */
export const RichImage = Node.create({
  name: "richImage",
  addOptions() {
    return { resizable: false };
  },
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      assetId: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-asset-id")?.slice(0, 128) ?? null,
      },
      src: {
        default: "",
        parseHTML: (element) =>
          sanitizeUrl(
            element.querySelector("img")?.getAttribute("src"),
            "image",
          ) ?? "",
      },
      alt: {
        default: "",
        parseHTML: (element) =>
          element.querySelector("img")?.getAttribute("alt")?.slice(0, 500) ??
          "",
      },
      caption: {
        default: "",
        parseHTML: (element) =>
          element.querySelector("figcaption")?.textContent?.slice(0, 1_000) ??
          "",
      },
      align: {
        default: "center",
        parseHTML: (element) =>
          ["left", "right"].includes(element.getAttribute("data-align") ?? "")
            ? element.getAttribute("data-align")
            : "center",
      },
      width: {
        default: 100,
        parseHTML: (element) =>
          parseInteger(element.getAttribute("data-width"), 100, 10, 100),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'figure[data-node-type="rich-image"]' }];
  },
  renderHTML({ node }) {
    const src = sanitizeUrl(node.attrs.src, "image") ?? "";
    const caption = String(node.attrs.caption ?? "");
    return [
      "figure",
      {
        class: `rt-rich-image rt-rich-image--${node.attrs.align === "left" || node.attrs.align === "right" ? String(node.attrs.align) : "center"}`,
        "data-node-type": "rich-image",
        "data-asset-id": node.attrs.assetId ? String(node.attrs.assetId) : "",
        "data-align":
          node.attrs.align === "left" || node.attrs.align === "right"
            ? String(node.attrs.align)
            : "center",
        "data-width": String(
          parseInteger(String(node.attrs.width), 100, 10, 100),
        ),
        style: `width: ${parseInteger(String(node.attrs.width), 100, 10, 100)}%;`,
      },
      ["img", { src, alt: String(node.attrs.alt ?? ""), draggable: "false" }],
      ["figcaption", {}, caption],
    ];
  },
  addCommands() {
    return {
      insertRichImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
  addNodeView() {
    return this.options.resizable ? ReactNodeViewRenderer(RichImageView) : null;
  },
});
