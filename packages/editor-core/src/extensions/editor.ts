import { type Extensions } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { createElement } from "react";
import { NovelExcerptNodeView } from "../novel-excerpt-node-view.js";
import type { NovelExcerptAttributes } from "../types.js";
import { NovelExcerpt } from "./novel-excerpt.js";

import { InlineCommentAnchor } from "./inline-comment-anchor.js";
import { LongTextBlock } from "./long-text-block.js";
import { PollRef } from "./poll-ref.js";
import { RichImage } from "./rich-image.js";
import { schemaExtensions } from "./schema.js";
import { ParagraphIndent } from "./paragraph-indent.js";
import { FormatPainter } from "./format-painter.js";

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
      case "novelExcerpt":
        return NovelExcerpt.extend({
          addNodeView: () => ReactNodeViewRenderer(({ node }) =>
            createElement(NovelExcerptNodeView, { attrs: node.attrs as unknown as NovelExcerptAttributes, editable: true }),
          ),
        });
      case "paragraphIndent":
        return ParagraphIndent;
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
  }).concat(FormatPainter, options.additionalExtensions ?? []);
}

/** Compatibility alias for the original editor extension factory. */
export const editorExtensions = createEditorExtensions;
