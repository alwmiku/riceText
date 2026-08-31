import { type Extensions, type JSONContent } from "@tiptap/core";
import { chapterStartExtension } from "@ricetext/document-core";
import { Color } from "@tiptap/extension-color";
import { FontFamily } from "@tiptap/extension-font-family";
import { Link } from "@tiptap/extension-link";
import { TextAlign } from "@tiptap/extension-text-align";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import { Underline } from "@tiptap/extension-underline";
import { StarterKit } from "@tiptap/starter-kit";

import {
  ALLOWED_FONT_FAMILIES,
  sanitizeColor,
  sanitizeFontSize,
  sanitizeUrl,
} from "../sanitize.js";
import type {
  AttachmentReferenceAttributes,
  DiceRollAttributes,
  InlineCommentAnchorAttributes,
  LongTextBlockAttributes,
  MentionAttributes,
  NovelExcerptAttributes,
  PollReferenceAttributes,
  ReplyGateAttributes,
  RichImageAttributes,
} from "../types.js";

import { InlineCommentAnchor } from "./inline-comment-anchor.js";
import { RichImage } from "./rich-image.js";
import { DiceRoll } from "./dice-roll.js";
import { NovelExcerpt } from "./novel-excerpt.js";
import { Mention } from "./mention.js";
import { ReplyGate } from "./reply-gate.js";
import { AttachmentRef } from "./attachment-ref.js";
import { PollRef } from "./poll-ref.js";
import { LongTextBlock } from "./long-text-block.js";
import { Spoiler } from "./spoiler.js";

export { InlineCommentAnchor } from "./inline-comment-anchor.js";
export { RichImage } from "./rich-image.js";
export { DiceRoll } from "./dice-roll.js";
export { NovelExcerpt } from "./novel-excerpt.js";
export { Mention } from "./mention.js";
export { ReplyGate } from "./reply-gate.js";
export { AttachmentRef } from "./attachment-ref.js";
export { PollRef } from "./poll-ref.js";
export { LongTextBlock } from "./long-text-block.js";
export { Spoiler } from "./spoiler.js";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    inlineCommentAnchor: {
      /** 在当前选区插入一个持久化的行内评论计数器。 */
      insertInlineCommentAnchor: (
        attrs: InlineCommentAnchorAttributes,
      ) => ReturnType;
    };
    richImage: {
      /** 插入一个已上传或外部的富图片块。 */
      insertRichImage: (attrs: RichImageAttributes) => ReturnType;
    };
    diceRoll: {
      /** 插入一个已求值的不可变骰子结果。 */
      insertDiceRoll: (attrs: DiceRollAttributes) => ReturnType;
    };
    novelExcerpt: {
      /** 插入一个带来源标注的小说摘录块。 */
      insertNovelExcerpt: (
        attrs: NovelExcerptAttributes,
        content?: JSONContent[],
      ) => ReturnType;
    };
    mention: {
      /** 插入一个已解析或未解析的用户提及。 */
      insertMention: (attrs: MentionAttributes) => ReturnType;
    };
    replyGate: {
      /** 插入一个回复门控内容块。 */
      insertReplyGate: (
        attrs: ReplyGateAttributes,
        content?: JSONContent[],
      ) => ReturnType;
    };
    attachmentRef: {
      /** 插入一个稳定的附件引用。 */
      insertAttachmentRef: (attrs: AttachmentReferenceAttributes) => ReturnType;
    };
    pollRef: {
      /** 插入一个稳定的投票引用。 */
      insertPollRef: (attrs: PollReferenceAttributes) => ReturnType;
    };
    longTextBlock: {
      /** 插入一个长文本章节块。 */
      insertLongTextBlock: (attrs: LongTextBlockAttributes) => ReturnType;
    };
    spoiler: {
      /** 将剧透标记应用到当前选区。 */
      setSpoiler: () => ReturnType;
      /** 切换当前选区上的剧透标记。 */
      toggleSpoiler: () => ReturnType;
      /** 从当前选区移除剧透标记。 */
      unsetSpoiler: () => ReturnType;
    };
  }
}

/** {@link editorExtensions} 接受的配置。 */
export interface EditorExtensionsOptions {
  /** 附加到共享 schema 之后的额外扩展。 */
  additionalExtensions?: Extensions;
  /** 启用带拖拽调整大小手柄的 React 富图片 NodeView。 */
  resizableImages?: boolean;
}

/**
 * 粘贴入口白名单：Tiptap 的 Color/FontFamily/FontSize 属性默认原样吸收外部
 * HTML 的 inline style，而持久化策略（document-core 白名单）会在保存时
 * fail-closed 拒绝整篇文档。这里在 HTML → 文档的入口处用同一份白名单过滤，
 * 白名单外的粘贴样式直接丢弃，保证编辑器产出的文档始终可保存。
 */

/** 字体栈取第一项（去引号）后与持久化白名单精确匹配。 */
function parseAllowedFontFamily(element: HTMLElement): string | null {
  const raw = element.style.fontFamily?.trim() ?? "";
  if (!raw) return null;
  const firstFamily = raw.split(",")[0]?.trim().replace(/^["']+|["']+$/g, "") ?? "";
  return (ALLOWED_FONT_FAMILIES as readonly string[]).includes(firstFamily)
    ? firstFamily
    : null;
}

/** 仅接受白名单内的整数像素字号（与 sanitizeFontSize 归一化结果一致）。 */
function parseAllowedFontSize(element: HTMLElement): string | null {
  const raw = element.style.fontSize?.trim() ?? "";
  const match = raw.match(/^(\d+)px$/u);
  if (!match) return null;
  return sanitizeFontSize(match[1]);
}

/**
 * 创建持久化文档与编辑器 UI 共用的规范 Tiptap schema。
 * 每个编辑器实例都应创建一份全新的数组。
 */
export function editorExtensions(
  options: EditorExtensionsOptions = {},
): Extensions {
  return [
    StarterKit.configure({ link: false, underline: false }),
    Underline,
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      protocols: ["http", "https", "mailto"],
      isAllowedUri: (url) => sanitizeUrl(url, "link") !== null,
      HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
    }).extend({
      // 持久化契约（document-core 白名单）只接受 href/target/rel：
      // 覆盖 Tiptap 默认的 class/title 属性，否则编辑器产出的 JSON 会在
      // 保存校验（fail-closed）时因 unknown-attribute 被整篇拒绝。
      addAttributes() {
        return {
          href: {
            default: null,
            parseHTML: (element) => element.getAttribute("href"),
          },
          target: { default: this.options.HTMLAttributes.target ?? null },
          rel: { default: this.options.HTMLAttributes.rel ?? null },
        };
      },
    }),
    TextStyle,
    Color.extend({
      // 粘贴颜色经 sanitizeColor 白名单：命名色 / rgba 等不可持久化的值不进文档。
      addGlobalAttributes() {
        return [
          {
            types: this.options.types,
            attributes: {
              color: {
                default: null,
                parseHTML: (element) => sanitizeColor(element.style.color ?? ""),
                renderHTML: (attributes) => {
                  if (!attributes.color) {
                    return {};
                  }
                  return { style: `color: ${attributes.color}` };
                },
              },
            },
          },
        ];
      },
    }).configure({ types: ["textStyle"] }),
    FontFamily.extend({
      // 粘贴字体栈经 ALLOWED_FONT_FAMILIES 白名单（同 parseAllowedFontFamily）。
      addGlobalAttributes() {
        return [
          {
            types: this.options.types,
            attributes: {
              fontFamily: {
                default: null,
                parseHTML: (element) => parseAllowedFontFamily(element),
                renderHTML: (attributes) => {
                  if (!attributes.fontFamily) {
                    return {};
                  }
                  return { style: `font-family: ${attributes.fontFamily}` };
                },
              },
            },
          },
        ];
      },
    }).configure({ types: ["textStyle"] }),
    FontSize.extend({
      // 粘贴字号仅接受白名单内的整数 px（同 parseAllowedFontSize）。
      addGlobalAttributes() {
        return [
          {
            types: this.options.types,
            attributes: {
              fontSize: {
                default: null,
                parseHTML: (element) => parseAllowedFontSize(element),
                renderHTML: (attributes) => {
                  if (!attributes.fontSize) {
                    return {};
                  }
                  return { style: `font-size: ${attributes.fontSize}` };
                },
              },
            },
          },
        ];
      },
    }).configure({ types: ["textStyle"] }),
    TextAlign.configure({
      types: ["heading", "paragraph", "listItem"],
      alignments: ["left", "center", "right", "justify"],
    }),
    chapterStartExtension,
    InlineCommentAnchor,
    RichImage.configure({ resizable: options.resizableImages === true }),
    DiceRoll,
    NovelExcerpt,
    Mention,
    ReplyGate,
    AttachmentRef,
    PollRef,
    LongTextBlock,
    Spoiler,
    ...(options.additionalExtensions ?? []),
  ];
}
