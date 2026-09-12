import { type JSONContent } from "@tiptap/core";

import type {
  AttachmentReferenceAttributes,
  DiceRollAttributes,
  EmojiAttributes,
  InlineCommentAnchorAttributes,
  LongTextBlockAttributes,
  MentionAttributes,
  NovelExcerptAttributes,
  PollReferenceAttributes,
  ReplyGateAttributes,
  RichImageAttributes,
} from "../types.js";

export { AttachmentRef } from "./attachment-ref.js";
export { Emoji } from "./emoji.js";
export type { EmojiStorage, EmojiTriggerState } from "./emoji.js";
export { DiceRoll } from "./dice-roll.js";
export { createEditorExtensions, editorExtensions } from "./editor.js";
export type { EditorExtensionsOptions } from "./editor.js";
export { InlineCommentAnchor } from "./inline-comment-anchor.js";
export { LongTextBlock } from "./long-text-block.js";
export { Mention } from "./mention.js";
export { NovelExcerpt } from "./novel-excerpt.js";
export { PollRef } from "./poll-ref.js";
export {
  RANGE_SELECTION_ATTRIBUTE,
  RangeSelectionHighlight,
  rangeSelectionKey,
} from "./range-selection.js";
export { ReplyGate } from "./reply-gate.js";
export { RichImage } from "./rich-image.js";
export { schemaExtensions } from "./schema.js";
export type { SchemaExtensionsOptions } from "./schema.js";
export { Spoiler } from "./spoiler.js";

// 集中声明命令扩展，确保根路径与子路径导入具有相同类型。
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    inlineCommentAnchor: {
      insertInlineCommentAnchor: (attrs: InlineCommentAnchorAttributes) => ReturnType;
    };
    richImage: {
      insertRichImage: (attrs: RichImageAttributes) => ReturnType;
    };
    diceRoll: {
      insertDiceRoll: (attrs: DiceRollAttributes) => ReturnType;
    };
    novelExcerpt: {
      insertNovelExcerpt: (attrs: NovelExcerptAttributes, content?: JSONContent[]) => ReturnType;
    };
    mention: {
      insertMention: (attrs: MentionAttributes) => ReturnType;
    };
    replyGate: {
      insertReplyGate: (attrs: ReplyGateAttributes, content?: JSONContent[]) => ReturnType;
    };
    attachmentRef: {
      insertAttachmentRef: (attrs: AttachmentReferenceAttributes) => ReturnType;
    };
    pollRef: {
      insertPollRef: (attrs: PollReferenceAttributes) => ReturnType;
    };
    longTextBlock: {
      insertLongTextBlock: (attrs: LongTextBlockAttributes) => ReturnType;
    };
    emoji: {
      /** 插入一个带目录属性的自定义表情节点。 */
      insertEmoji: (attrs: EmojiAttributes) => ReturnType;
      /** 按目录 id 插入：自定义表情插入节点，纯文本表情插入字符。 */
      insertEmojiFromQuery: (emojiId: string) => ReturnType;
    };
    spoiler: {
      setSpoiler: () => ReturnType;
      toggleSpoiler: () => ReturnType;
      unsetSpoiler: () => ReturnType;
    };
  }
}
