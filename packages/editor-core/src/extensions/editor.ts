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
import { SharedClipboard } from "./clipboard.js";

export interface EditorExtensionsOptions {
  /** 追加在规范编辑器组合之后的扩展。 */
  additionalExtensions?: Extensions;
  /** 启用带缩放手柄的 React 富图片 NodeView。 */
  resizableImages?: boolean;
}

/** 通过添加编辑器专用插件和 React NodeView 创建可编辑组合。 */
export function createEditorExtensions(options: EditorExtensionsOptions = {}): Extensions {
  return schemaExtensions()
    .map((extension) => {
      switch (extension.name) {
        case "novelExcerpt":
          return NovelExcerpt.extend({
            addNodeView: () => {
              const render = ReactNodeViewRenderer(({ node, editor, getPos, selected }) =>
                createElement(NovelExcerptNodeView, {
                  attrs: node.attrs as unknown as NovelExcerptAttributes,
                  editable: true,
                  editor,
                  getPos,
                  selected,
                }),
              );
              return (props) => {
                const nodeView = render(props);
                const ignoreMutation = nodeView.ignoreMutation?.bind(nodeView);
                nodeView.ignoreMutation = (mutation) => {
                  // React 搬移正文容器或更新阅读装饰不是输入；Android 不应将其推断为回车。
                  // 正文内部和选区仍交给原生处理，保留输入法、换行与格式修改。
                  if (
                    mutation.type !== "selection" &&
                    nodeView.contentDOM &&
                    !nodeView.contentDOM.contains(mutation.target)
                  )
                    return true;
                  return ignoreMutation?.(mutation) ?? false;
                };
                return nodeView;
              };
            },
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
    })
    .concat(FormatPainter, SharedClipboard, options.additionalExtensions ?? []);
}

/** 原有编辑器扩展工厂的兼容别名。 */
export const editorExtensions = createEditorExtensions;
