import { ReactNodeViewRenderer } from "@tiptap/react";

import { LongTextView } from "../long-text-node-view.js";
import { LongTextBlockSchema } from "./long-text-block-schema.js";

/** Editable long-text block with editor storage and its React NodeView. */
export const LongTextBlock = LongTextBlockSchema.extend({
  addStorage() {
    return {
      onSplit: null as null | ((before: string, after: string) => void),
      onChapterEdit:
        null as null | ((chapterId: string, patch: { title?: string; text?: string }) => void),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(LongTextView);
  },
});
