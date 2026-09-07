import { ReactNodeViewRenderer } from "@tiptap/react";

import { PollEditorView } from "../poll-node-view.js";
import { PollRefSchema } from "./poll-ref-schema.js";

/** 包含 React 编辑器 NodeView 的可编辑投票引用。 */
export const PollRef = PollRefSchema.extend({
  addNodeView() {
    return ReactNodeViewRenderer(PollEditorView);
  },
});
