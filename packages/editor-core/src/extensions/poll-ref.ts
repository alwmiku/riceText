import { ReactNodeViewRenderer } from "@tiptap/react";

import { PollEditorView } from "../poll-node-view.js";
import { PollRefSchema } from "./poll-ref-schema.js";

/** Editable poll reference with its React editor NodeView. */
export const PollRef = PollRefSchema.extend({
  addNodeView() {
    return ReactNodeViewRenderer(PollEditorView);
  },
});
