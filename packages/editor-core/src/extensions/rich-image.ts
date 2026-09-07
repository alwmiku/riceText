import { ReactNodeViewRenderer } from "@tiptap/react";

import { RichImageView } from "../rich-image-node-view.js";
import { RichImageSchema } from "./rich-image-schema.js";

/** 可选配支持缩放的 React NodeView 的可编辑富图片节点。 */
export const RichImage = RichImageSchema.extend({
  addOptions() {
    return { resizable: false };
  },
  addNodeView() {
    return this.options.resizable ? ReactNodeViewRenderer(RichImageView) : null;
  },
});
