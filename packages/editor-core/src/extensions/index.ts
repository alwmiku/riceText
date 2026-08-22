import { type Extensions, type JSONContent } from "@tiptap/core";
import { Color } from "@tiptap/extension-color";
import { FontFamily } from "@tiptap/extension-font-family";
import { Link } from "@tiptap/extension-link";
import { TextAlign } from "@tiptap/extension-text-align";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import { Underline } from "@tiptap/extension-underline";
import { StarterKit } from "@tiptap/starter-kit";

import { sanitizeUrl } from "../sanitize.js";
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
    }),
    TextStyle,
    Color.configure({ types: ["textStyle"] }),
    FontFamily.configure({ types: ["textStyle"] }),
    FontSize.configure({ types: ["textStyle"] }),
    TextAlign.configure({
      types: ["heading", "paragraph", "listItem"],
      alignments: ["left", "center", "right", "justify"],
    }),
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
