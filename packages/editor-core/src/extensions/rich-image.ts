import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { richImageNodeSpec } from "@ricetext/document-core";

import { RichImageView } from "../rich-image-node-view.js";

/** 用于已上传图片与外部图片的 Tiptap 块节点（规格来自 document-core）。 */
export const RichImage = Node.create({
  ...richImageNodeSpec,
  addOptions() {
    return { resizable: false };
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
