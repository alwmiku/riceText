import { ReactNodeViewRenderer } from "@tiptap/react";

import { LongTextView } from "../long-text-node-view.js";
import { LongTextBlockSchema } from "./long-text-block-schema.js";

/** 包含编辑器存储和 React NodeView 的可编辑长文本块。 */
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
