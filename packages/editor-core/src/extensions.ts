import { Mark, Node, type Extensions, type JSONContent } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Color } from "@tiptap/extension-color";
import { FontFamily } from "@tiptap/extension-font-family";
import { Link } from "@tiptap/extension-link";
import { TextAlign } from "@tiptap/extension-text-align";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import { Underline } from "@tiptap/extension-underline";
import { StarterKit } from "@tiptap/starter-kit";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { LongTextView } from "./long-text-node-view.js";
import { RichImageView } from "./rich-image-node-view.js";

import { sanitizeUrl } from "./sanitize.js";
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
} from "./types.js";

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

function parseInteger(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const numeric = value === null ? Number.NaN : Number.parseInt(value, 10);
  return Number.isFinite(numeric)
    ? Math.min(max, Math.max(min, numeric))
    : fallback;
}

function parseJsonArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Counts persisted inline-comment anchors in a ProseMirror document. */
function countInlineCommentAnchors(doc: ProseMirrorNode): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name === "inlineCommentAnchor") count += 1;
  });
  return count;
}

/** Tiptap node for paragraph-start or paragraph-end comment counters. */
export const InlineCommentAnchor = Node.create({
  name: "inlineCommentAnchor",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      threadId: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-thread-id")?.slice(0, 128) ?? "",
      },
      count: {
        default: 0,
        parseHTML: (element) =>
          parseInteger(element.getAttribute("data-count"), 0, 0, 1_000_000),
      },
      placement: {
        default: "end",
        parseHTML: (element) =>
          element.getAttribute("data-placement") === "start" ? "start" : "end",
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-node-type="inline-comment-anchor"]' }];
  },
  renderHTML({ node }) {
    const empty = Number(node.attrs.count) <= 0;
    return [
      "span",
      {
        class: `rt-inline-comment-anchor${empty ? " rt-inline-comment-anchor--empty" : ""}`,
        "data-node-type": "inline-comment-anchor",
        "data-thread-id": String(node.attrs.threadId),
        "data-count": String(node.attrs.count),
        "data-placement": node.attrs.placement === "start" ? "start" : "end",
        contenteditable: "false",
      },
      empty ? "" : String(node.attrs.count),
    ];
  },
  addCommands() {
    return {
      insertInlineCommentAnchor:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("inlineCommentAnchorProtected"),
        filterTransaction: (transaction, state) => {
          if (!transaction.docChanged) return true;
          const before = countInlineCommentAnchors(state.doc);
          const after = countInlineCommentAnchors(transaction.doc);
          return after >= before;
        },
      }),
    ];
  },
});

/** Tiptap block node for uploaded and external images. */
export const RichImage = Node.create({
  name: "richImage",
  addOptions() {
    return { resizable: false };
  },
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      assetId: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-asset-id")?.slice(0, 128) ?? null,
      },
      src: {
        default: "",
        parseHTML: (element) =>
          sanitizeUrl(
            element.querySelector("img")?.getAttribute("src"),
            "image",
          ) ?? "",
      },
      alt: {
        default: "",
        parseHTML: (element) =>
          element.querySelector("img")?.getAttribute("alt")?.slice(0, 500) ??
          "",
      },
      caption: {
        default: "",
        parseHTML: (element) =>
          element.querySelector("figcaption")?.textContent?.slice(0, 1_000) ??
          "",
      },
      align: {
        default: "center",
        parseHTML: (element) =>
          ["left", "right"].includes(element.getAttribute("data-align") ?? "")
            ? element.getAttribute("data-align")
            : "center",
      },
      width: {
        default: 100,
        parseHTML: (element) =>
          parseInteger(element.getAttribute("data-width"), 100, 10, 100),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'figure[data-node-type="rich-image"]' }];
  },
  renderHTML({ node }) {
    const src = sanitizeUrl(node.attrs.src, "image") ?? "";
    const caption = String(node.attrs.caption ?? "");
    return [
      "figure",
      {
        class: `rt-rich-image rt-rich-image--${node.attrs.align === "left" || node.attrs.align === "right" ? String(node.attrs.align) : "center"}`,
        "data-node-type": "rich-image",
        "data-asset-id": node.attrs.assetId ? String(node.attrs.assetId) : "",
        "data-align":
          node.attrs.align === "left" || node.attrs.align === "right"
            ? String(node.attrs.align)
            : "center",
        "data-width": String(
          parseInteger(String(node.attrs.width), 100, 10, 100),
        ),
        style: `width: ${parseInteger(String(node.attrs.width), 100, 10, 100)}%;`,
      },
      ["img", { src, alt: String(node.attrs.alt ?? ""), draggable: "false" }],
      ["figcaption", {}, caption],
    ];
  },
  addCommands() {
    return {
      insertRichImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
  addNodeView() {
    return this.options.resizable ? ReactNodeViewRenderer(RichImageView) : null;
  },
});

/** Tiptap inline atom for an immutable server-generated dice result. */
export const DiceRoll = Node.create({
  name: "diceRoll",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  marks: "_",
  addAttributes() {
    return {
      rollId: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-roll-id")?.slice(0, 128) ?? "",
      },
      expression: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-expression")?.slice(0, 80) ?? "",
      },
      rolls: {
        default: [],
        parseHTML: (element) =>
          parseJsonArray(element.getAttribute("data-rolls"))
            .slice(0, 100)
            .map(Number)
            .filter(Number.isFinite),
      },
      total: {
        default: 0,
        parseHTML: (element) =>
          parseInteger(
            element.getAttribute("data-total"),
            0,
            -100_000_000,
            100_000_000,
          ),
      },
      rerollOf: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-reroll-of")?.slice(0, 128) ?? null,
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-node-type="dice-roll"]' }];
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        class: "rt-dice-roll",
        "data-node-type": "dice-roll",
        "data-roll-id": String(node.attrs.rollId),
        "data-expression": String(node.attrs.expression),
        "data-rolls": JSON.stringify(node.attrs.rolls),
        "data-total": String(node.attrs.total),
        "data-reroll-of": node.attrs.rerollOf
          ? String(node.attrs.rerollOf)
          : "",
        contenteditable: "false",
      },
      `${String(node.attrs.expression)} = ${String(node.attrs.total)}`,
    ];
  },
  addCommands() {
    return {
      insertDiceRoll:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

/** Tiptap block node for searchable source-attributed novel text. */
export const NovelExcerpt = Node.create({
  name: "novelExcerpt",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      bookTitle: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-book-title")?.slice(0, 300) ?? "",
      },
      chapterTitle: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-chapter-title")?.slice(0, 300) ?? "",
      },
      author: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-author")?.slice(0, 200) ?? "",
      },
      sourceUrl: {
        default: null,
        parseHTML: (element) =>
          sanitizeUrl(element.getAttribute("data-source-url"), "link"),
      },
      variant: {
        default: "desktop-book",
        parseHTML: (element) =>
          ["mobile-book", "forum-evidence"].includes(
            element.getAttribute("data-variant") ?? "",
          )
            ? element.getAttribute("data-variant")
            : "desktop-book",
      },
    };
  },
  parseHTML() {
    return [{ tag: 'aside[data-node-type="novel-excerpt"]' }];
  },
  renderHTML({ node }) {
    return [
      "aside",
      {
        class: `rt-novel-excerpt rt-novel-excerpt--${String(node.attrs.variant)}`,
        "data-node-type": "novel-excerpt",
        "data-book-title": String(node.attrs.bookTitle),
        "data-chapter-title": String(node.attrs.chapterTitle),
        "data-author": String(node.attrs.author),
        "data-source-url": sanitizeUrl(node.attrs.sourceUrl, "link") ?? "",
        "data-variant": String(node.attrs.variant),
      },
      0,
    ];
  },
  addCommands() {
    return {
      insertNovelExcerpt:
        (attrs, content = [{ type: "paragraph" }]) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs, content }),
    };
  },
});

/** Tiptap inline atom for resolved and unresolved user mentions. */
export const Mention = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  marks: "_",
  addAttributes() {
    return {
      userId: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-user-id")?.slice(0, 128) ?? null,
      },
      name: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-name")?.slice(0, 100) ?? "",
      },
      resolved: {
        default: false,
        parseHTML: (element) =>
          element.getAttribute("data-resolved") === "true",
      },
      avatarUrl: {
        default: null,
        parseHTML: (element) =>
          sanitizeUrl(element.getAttribute("data-avatar-url"), "image"),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-node-type="mention"]' }];
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        class: `rt-mention ${node.attrs.resolved === true ? "rt-mention--resolved" : "rt-mention--unresolved"}`,
        "data-node-type": "mention",
        "data-user-id": node.attrs.userId ? String(node.attrs.userId) : "",
        "data-name": String(node.attrs.name),
        "data-resolved": node.attrs.resolved === true ? "true" : "false",
        "data-avatar-url": sanitizeUrl(node.attrs.avatarUrl, "image") ?? "",
        contenteditable: "false",
      },
      `@${String(node.attrs.name)}`,
    ];
  },
  addCommands() {
    return {
      insertMention:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

/** Tiptap block node whose content is projected according to reply access. */
export const ReplyGate = Node.create({
  name: "replyGate",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      gateId: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-gate-id")?.slice(0, 128) ?? "",
      },
      prompt: {
        default: "Reply to view this content",
        parseHTML: (element) =>
          element.getAttribute("data-prompt")?.slice(0, 300) ??
          "Reply to view this content",
      },
    };
  },
  parseHTML() {
    return [{ tag: 'section[data-node-type="reply-gate"]' }];
  },
  renderHTML({ node }) {
    return [
      "section",
      {
        class: "rt-reply-gate",
        "data-node-type": "reply-gate",
        "data-gate-id": String(node.attrs.gateId),
        "data-prompt": String(node.attrs.prompt),
      },
      0,
    ];
  },
  addCommands() {
    return {
      insertReplyGate:
        (attrs, content = [{ type: "paragraph" }]) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs, content }),
    };
  },
});

/** Tiptap atom that references a separately persisted downloadable file. */
export const AttachmentRef = Node.create({
  name: "attachmentRef",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      attachmentId: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-attachment-id")?.slice(0, 128) ?? "",
      },
      name: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-name")?.slice(0, 300) ?? "",
      },
      mimeType: {
        default: "application/octet-stream",
        parseHTML: (element) =>
          element.getAttribute("data-mime-type")?.slice(0, 120) ??
          "application/octet-stream",
      },
      size: {
        default: 0,
        parseHTML: (element) =>
          parseInteger(
            element.getAttribute("data-size"),
            0,
            0,
            Number.MAX_SAFE_INTEGER,
          ),
      },
      priceCoins: {
        default: 0,
        parseHTML: (element) =>
          parseInteger(
            element.getAttribute("data-price-coins"),
            0,
            0,
            1_000_000_000,
          ),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-node-type="attachment-ref"]' }];
  },
  renderHTML({ node }) {
    return [
      "div",
      {
        class: "rt-attachment",
        "data-node-type": "attachment-ref",
        "data-attachment-id": String(node.attrs.attachmentId),
        "data-name": String(node.attrs.name),
        "data-mime-type": String(node.attrs.mimeType),
        "data-size": String(node.attrs.size),
        "data-price-coins": String(node.attrs.priceCoins),
        contenteditable: "false",
      },
      `${String(node.attrs.name)} · ${String(node.attrs.priceCoins)} 金币`,
    ];
  },
  addCommands() {
    return {
      insertAttachmentRef:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

/** Tiptap atom that references a server-hydrated poll. */
export const PollRef = Node.create({
  name: "pollRef",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      pollId: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-poll-id")?.slice(0, 128) ?? "",
      },
      question: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-question")?.slice(0, 500) ?? "",
      },
      multiple: {
        default: false,
        parseHTML: (element) =>
          element.getAttribute("data-multiple") === "true",
      },
      options: {
        default: [],
        parseHTML: (element) =>
          parseJsonArray(element.getAttribute("data-options")).slice(0, 100),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'section[data-node-type="poll-ref"]' }];
  },
  renderHTML({ node }) {
    return [
      "section",
      {
        class: "rt-poll",
        "data-node-type": "poll-ref",
        "data-poll-id": String(node.attrs.pollId),
        "data-question": String(node.attrs.question),
        "data-multiple": node.attrs.multiple === true ? "true" : "false",
        "data-options": JSON.stringify(node.attrs.options),
        contenteditable: "false",
      },
      String(node.attrs.question),
    ];
  },
  addCommands() {
    return {
      insertPollRef:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

/** Tiptap block node for long novel chapters with a virtualized React view. */
export const LongTextBlock = Node.create({
  name: "longTextBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      chapterId: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-chapter-id")?.slice(0, 128) ?? "",
      },
      title: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-title")?.slice(0, 500) ?? "",
      },
      text: {
        default: "",
        parseHTML: (element) =>
          element.textContent?.slice(0, 100_000_000) ?? "",
      },
      order: {
        default: 0,
        parseHTML: (element) =>
          parseInteger(element.getAttribute("data-order"), 0, 0, 1_000_000),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'section[data-node-type="long-text-block"]' }];
  },
  renderHTML({ node }) {
    return [
      "section",
      {
        class: "rt-long-text",
        "data-node-type": "long-text-block",
        "data-chapter-id": String(node.attrs.chapterId ?? ""),
        "data-title": String(node.attrs.title ?? ""),
        "data-order": String(node.attrs.order ?? 0),
      },
      String(node.attrs.text ?? ""),
    ];
  },
  addCommands() {
    return {
      insertLongTextBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(LongTextView);
  },
});

/** Tiptap mark for hover-to-reveal and tap-to-toggle spoiler text. */
export const Spoiler = Mark.create({
  name: "spoiler",
  inclusive: false,
  excludes: "bold italic textStyle",
  parseHTML() {
    return [{ tag: "span[data-spoiler]" }];
  },
  renderHTML() {
    return ["span", { class: "rt-spoiler", "data-spoiler": "true" }, 0];
  },
  addCommands() {
    return {
      setSpoiler:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      toggleSpoiler:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
      unsetSpoiler:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

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
