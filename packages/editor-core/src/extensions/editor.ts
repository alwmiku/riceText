import { type Extensions } from "@tiptap/core";

import { InlineCommentAnchor } from "./inline-comment-anchor.js";
import { LongTextBlock } from "./long-text-block.js";
import { PollRef } from "./poll-ref.js";
import { RichImage } from "./rich-image.js";
import { schemaExtensions } from "./schema.js";

export interface EditorExtensionsOptions {
  /** Extensions appended after the canonical editor composition. */
  additionalExtensions?: Extensions;
  /** Enables the React rich-image NodeView with resize handles. */
  resizableImages?: boolean;
}

/** Creates the editable composition by adding editor-only plugins and React NodeViews. */
export function createEditorExtensions(
  options: EditorExtensionsOptions = {},
): Extensions {
  return schemaExtensions().map((extension) => {
    switch (extension.name) {
      case "inlineCommentAnchor":
        return InlineCommentAnchor;
      case "richImage":
        return RichImage.configure({ resizable: options.resizableImages === true });
      case "pollRef":
        return PollRef;
      case "longTextBlock":
        return LongTextBlock;
      default:
        return extension;
    }
  }).concat(options.additionalExtensions ?? []);
}

/** Compatibility alias for the original editor extension factory. */
export const editorExtensions = createEditorExtensions;
