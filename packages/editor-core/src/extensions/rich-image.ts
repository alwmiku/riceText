import { ReactNodeViewRenderer } from "@tiptap/react";

import { RichImageView } from "../rich-image-node-view.js";
import { RichImageSchema } from "./rich-image-schema.js";

/** Editable rich-image node with an optional resize-capable React NodeView. */
export const RichImage = RichImageSchema.extend({
  addOptions() {
    return { resizable: false };
  },
  addNodeView() {
    return this.options.resizable ? ReactNodeViewRenderer(RichImageView) : null;
  },
});
