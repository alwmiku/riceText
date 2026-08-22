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
      /** Inserts a persisted inline-comment counter at the current selection. */
      insertInlineCommentAnchor: (
        attrs: InlineCommentAnchorAttributes,
      ) => ReturnType;
    };
    richImage: {
      /** Inserts an uploaded or external rich image block. */
      insertRichImage: (attrs: RichImageAttributes) => ReturnType;
    };
    diceRoll: {
      /** Inserts an already evaluated immutable dice result. */
      insertDiceRoll: (attrs: DiceRollAttributes) => ReturnType;
    };
    novelExcerpt: {
      /** Inserts a source-attributed novel excerpt block. */
      insertNovelExcerpt: (
        attrs: NovelExcerptAttributes,
        content?: JSONContent[],
      ) => ReturnType;
    };
    mention: {
      /** Inserts a resolved or unresolved user mention. */
      insertMention: (attrs: MentionAttributes) => ReturnType;
    };
    replyGate: {
      /** Inserts a reply-gated content block. */
      insertReplyGate: (
        attrs: ReplyGateAttributes,
        content?: JSONContent[],
      ) => ReturnType;
    };
    attachmentRef: {
      /** Inserts a stable attachment reference. */
      insertAttachmentRef: (attrs: AttachmentReferenceAttributes) => ReturnType;
    };
    pollRef: {
      /** Inserts a stable poll reference. */
      insertPollRef: (attrs: PollReferenceAttributes) => ReturnType;
    };
    longTextBlock: {
      /** Inserts a long-text chapter block. */
      insertLongTextBlock: (attrs: LongTextBlockAttributes) => ReturnType;
    };
    spoiler: {
      /** Applies the spoiler mark to the current selection. */
      setSpoiler: () => ReturnType;
      /** Toggles the spoiler mark on the current selection. */
      toggleSpoiler: () => ReturnType;
      /** Removes the spoiler mark from the current selection. */
      unsetSpoiler: () => ReturnType;
    };
  }
}

/** Configuration accepted by {@link editorExtensions}. */
export interface EditorExtensionsOptions {
  /** Additional extensions appended after the shared schema. */
  additionalExtensions?: Extensions;
  /** Enables the React rich-image NodeView with drag resize handles. */
  resizableImages?: boolean;
}

/**
 * Creates the canonical Tiptap schema used by both persisted documents and the
 * editor UI. Create a fresh array for every editor instance.
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
