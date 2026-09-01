import { type JSONContent } from "@tiptap/core";

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

export { AttachmentRef } from "./attachment-ref.js";
export { DiceRoll } from "./dice-roll.js";
export { createEditorExtensions, editorExtensions } from "./editor.js";
export type { EditorExtensionsOptions } from "./editor.js";
export { InlineCommentAnchor } from "./inline-comment-anchor.js";
export { LongTextBlock } from "./long-text-block.js";
export { Mention } from "./mention.js";
export { NovelExcerpt } from "./novel-excerpt.js";
export { PollRef } from "./poll-ref.js";
export { ReplyGate } from "./reply-gate.js";
export { RichImage } from "./rich-image.js";
export { schemaExtensions } from "./schema.js";
export type { SchemaExtensionsOptions } from "./schema.js";
export { Spoiler } from "./spoiler.js";

// Keep command augmentation centralized so root and subpath imports expose identical typing.
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
      insertNovelExcerpt: (
        attrs: NovelExcerptAttributes,
        content?: JSONContent[],
      ) => ReturnType;
    };
    mention: {
      insertMention: (attrs: MentionAttributes) => ReturnType;
    };
    replyGate: {
      insertReplyGate: (
        attrs: ReplyGateAttributes,
        content?: JSONContent[],
      ) => ReturnType;
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
    spoiler: {
      setSpoiler: () => ReturnType;
      toggleSpoiler: () => ReturnType;
      unsetSpoiler: () => ReturnType;
    };
  }
}
