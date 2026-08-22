import { Node } from "@tiptap/core";

import { sanitizeUrl } from "../sanitize.js";

/** Tiptap block node for searchable source-attributed novel text. */
export const NovelExcerpt = Node.create({
  name: "novelExcerpt",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      bookTitle: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-book-title")?.slice(0, 300) ?? "",
      },
      chapterTitle: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-chapter-title")?.slice(0, 300) ?? "",
      },
      author: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-author")?.slice(0, 200) ?? "",
      },
      sourceUrl: {
        default: null,
        parseHTML: (element) =>
          sanitizeUrl(element.getAttribute("data-source-url"), "link"),
      },
      variant: {
        default: "desktop-book",
        parseHTML: (element) =>
          ["mobile-book", "forum-evidence"].includes(
            element.getAttribute("data-variant") ?? "",
          )
            ? element.getAttribute("data-variant")
            : "desktop-book",
      },
    };
  },
  parseHTML() {
    return [{ tag: 'aside[data-node-type="novel-excerpt"]' }];
  },
  renderHTML({ node }) {
    return [
      "aside",
      {
        class: `rt-novel-excerpt rt-novel-excerpt--${String(node.attrs.variant)}`,
        "data-node-type": "novel-excerpt",
        "data-book-title": String(node.attrs.bookTitle),
        "data-chapter-title": String(node.attrs.chapterTitle),
        "data-author": String(node.attrs.author),
        "data-source-url": sanitizeUrl(node.attrs.sourceUrl, "link") ?? "",
        "data-variant": String(node.attrs.variant),
      },
      0,
    ];
  },
  addCommands() {
    return {
      insertNovelExcerpt:
        (attrs, content = [{ type: "paragraph" }]) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs, content }),
    };
  },
});
