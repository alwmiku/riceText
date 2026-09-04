import type { MarkConfig, NodeConfig } from "@tiptap/core";
import { sanitizeUrl } from "./sanitize.js";
import { parseInteger, parseJsonArray } from "./helpers.js";

/**
 * 共享的节点/标记规格（单一权威来源）。
 *
 * 服务端（document-core 的 schema 构建）与编辑器 UI（editor-core 的 Tiptap
 * 扩展，在规格之上追加命令与 React NodeView）消费同一批常量，保证两边
 * 的 ProseMirror schema 永不分叉。规格不包含任何 React 依赖。
 */

/** 用于已上传图片与外部图片的块节点。 */
export const richImageNodeSpec = {
  name: "richImage",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      assetId: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-asset-id")?.slice(0, 128) ?? null,
      },
      src: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          sanitizeUrl(
            element.querySelector("img")?.getAttribute("src"),
            "image",
          ) ?? "",
      },
      alt: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.querySelector("img")?.getAttribute("alt")?.slice(0, 500) ?? "",
      },
      caption: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.querySelector("figcaption")?.textContent?.slice(0, 1_000) ?? "",
      },
      align: {
        default: "center",
        parseHTML: (element: HTMLElement) =>
          ["left", "right"].includes(element.getAttribute("data-align") ?? "")
            ? element.getAttribute("data-align")
            : "center",
      },
      width: {
        default: 100,
        parseHTML: (element: HTMLElement) =>
          parseInteger(element.getAttribute("data-width"), 100, 10, 100),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'figure[data-node-type="rich-image"]' }];
  },
  renderHTML({ node }: { node: { attrs: Record<string, unknown> } }) {
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
        "data-width": String(parseInteger(String(node.attrs.width), 100, 10, 100)),
        style: `width: ${parseInteger(String(node.attrs.width), 100, 10, 100)}%;`,
      },
      ["img", { src, alt: String(node.attrs.alt ?? ""), draggable: "false" }],
      ["figcaption", {}, caption],
    ];
  },
} satisfies NodeConfig;

/** 服务端生成的不可变骰子结果的行内原子节点。 */
export const diceRollNodeSpec = {
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
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-roll-id")?.slice(0, 128) ?? "",
      },
      expression: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-expression")?.slice(0, 80) ?? "",
      },
      rolls: {
        default: [],
        parseHTML: (element: HTMLElement) =>
          parseJsonArray(element.getAttribute("data-rolls"))
            .slice(0, 100)
            .map(Number)
            .filter(Number.isFinite),
      },
      total: {
        default: 0,
        parseHTML: (element: HTMLElement) =>
          parseInteger(
            element.getAttribute("data-total"),
            0,
            -100_000_000,
            100_000_000,
          ),
      },
      rerollOf: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-reroll-of")?.slice(0, 128) ?? null,
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-node-type="dice-roll"]' }];
  },
  renderHTML({ node }: { node: { attrs: Record<string, unknown> } }) {
    return [
      "span",
      {
        class: "rt-dice-roll",
        "data-node-type": "dice-roll",
        "data-roll-id": String(node.attrs.rollId),
        "data-expression": String(node.attrs.expression),
        "data-rolls": JSON.stringify(node.attrs.rolls),
        "data-total": String(node.attrs.total),
        "data-reroll-of": node.attrs.rerollOf ? String(node.attrs.rerollOf) : "",
        contenteditable: "false",
      },
      `${String(node.attrs.expression)} = ${String(node.attrs.total)}`,
    ];
  },
} satisfies NodeConfig;

/** 可搜索、带来源标注的小说文本的块节点。 */
export const novelExcerptNodeSpec = {
  name: "novelExcerpt",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      bookTitle: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-book-title")?.slice(0, 300) ?? "",
      },
      chapterTitle: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-chapter-title")?.slice(0, 300) ?? "",
      },
      author: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-author")?.slice(0, 200) ?? "",
      },
      sourceUrl: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          sanitizeUrl(element.getAttribute("data-source-url"), "link"),
      },
      variant: {
        default: "desktop-book",
        parseHTML: (element: HTMLElement) =>
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
  renderHTML({ node }: { node: { attrs: Record<string, unknown> } }) {
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
} satisfies NodeConfig;

/** 已解析与未解析用户提及的行内原子节点。 */
export const mentionNodeSpec = {
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
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-user-id")?.slice(0, 128) ?? null,
      },
      name: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-name")?.slice(0, 100) ?? "",
      },
      resolved: {
        default: false,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-resolved") === "true",
      },
      avatarUrl: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          sanitizeUrl(element.getAttribute("data-avatar-url"), "image"),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-node-type="mention"]' }];
  },
  renderHTML({ node }: { node: { attrs: Record<string, unknown> } }) {
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
} satisfies NodeConfig;

/** 内容根据回复访问权限进行投射的块节点。 */
export const replyGateNodeSpec = {
  name: "replyGate",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      gateId: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-gate-id")?.slice(0, 128) ?? "",
      },
      prompt: {
        default: "Reply to view this content",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-prompt")?.slice(0, 300) ??
          "Reply to view this content",
      },
    };
  },
  parseHTML() {
    return [{ tag: 'section[data-node-type="reply-gate"]' }];
  },
  renderHTML({ node }: { node: { attrs: Record<string, unknown> } }) {
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
} satisfies NodeConfig;

/** 引用单独持久化的可下载文件的原子节点。 */
export const attachmentRefNodeSpec = {
  name: "attachmentRef",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      attachmentId: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-attachment-id")?.slice(0, 128) ?? "",
      },
      name: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-name")?.slice(0, 300) ?? "",
      },
      mimeType: {
        default: "application/octet-stream",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-mime-type")?.slice(0, 120) ??
          "application/octet-stream",
      },
      size: {
        default: 0,
        parseHTML: (element: HTMLElement) =>
          parseInteger(element.getAttribute("data-size"), 0, 0, Number.MAX_SAFE_INTEGER),
      },
      priceCoins: {
        default: 0,
        parseHTML: (element: HTMLElement) =>
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
  renderHTML({ node }: { node: { attrs: Record<string, unknown> } }) {
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
} satisfies NodeConfig;

/** 引用服务端数据填充（hydrated）投票的原子节点。 */
export const pollRefNodeSpec = {
  name: "pollRef",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      pollId: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-poll-id")?.slice(0, 128) ?? "",
      },
      question: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-question")?.slice(0, 500) ?? "",
      },
      multiple: {
        default: false,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-multiple") === "true",
      },
      options: {
        default: [],
        parseHTML: (element: HTMLElement) =>
          parseJsonArray(element.getAttribute("data-options")).slice(0, 100),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'section[data-node-type="poll-ref"]' }];
  },
  renderHTML({ node }: { node: { attrs: Record<string, unknown> } }) {
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
} satisfies NodeConfig;

/** 长篇小说章节、带虚拟化 React 视图的块节点。 */
export const longTextBlockNodeSpec = {
  name: "longTextBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      chapterId: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-chapter-id")?.slice(0, 128) ?? "",
      },
      title: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-title")?.slice(0, 500) ?? "",
      },
      volumeTitle: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-volume-title")?.slice(0, 500) ?? "",
      },
      text: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.textContent?.slice(0, 100_000_000) ?? "",
      },
      order: {
        default: 0,
        parseHTML: (element: HTMLElement) =>
          parseInteger(element.getAttribute("data-order"), 0, 0, 1_000_000),
      },
      start: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          parseInteger(
            element.getAttribute("data-start"),
            null,
            0,
            10_000_000_000,
          ),
      },
      end: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          parseInteger(element.getAttribute("data-end"), null, 0, 10_000_000_000),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'section[data-node-type="long-text-block"]' }];
  },
  renderHTML({ node }: { node: { attrs: Record<string, unknown> } }) {
    const start = node.attrs.start;
    const end = node.attrs.end;
    return [
      "section",
      {
        class: "rt-long-text",
        "data-node-type": "long-text-block",
        "data-chapter-id": String(node.attrs.chapterId ?? ""),
        "data-title": String(node.attrs.title ?? ""),
        "data-volume-title": String(node.attrs.volumeTitle ?? ""),
        "data-order": String(node.attrs.order ?? 0),
        ...(start === null ? {} : { "data-start": String(start) }),
        ...(end === null ? {} : { "data-end": String(end) }),
      },
      String(node.attrs.text ?? ""),
    ];
  },
} satisfies NodeConfig;

/** 用于段落起始或段落末尾评论计数器的行内原子节点。 */
export const inlineCommentAnchorNodeSpec = {
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
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-thread-id")?.slice(0, 128) ?? "",
      },
      count: {
        default: 0,
        parseHTML: (element: HTMLElement) =>
          parseInteger(element.getAttribute("data-count"), 0, 0, 1_000_000),
      },
      placement: {
        default: "end",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-placement") === "start" ? "start" : "end",
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-node-type="inline-comment-anchor"]' }];
  },
  renderHTML({ node }: { node: { attrs: Record<string, unknown> } }) {
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
} satisfies NodeConfig;

/** 悬停显示与点击切换剧透文本的标记。 */
export const spoilerMarkSpec = {
  name: "spoiler",
  inclusive: false,
  excludes: "bold italic textStyle",
  parseHTML() {
    return [{ tag: "span[data-spoiler]" }];
  },
  renderHTML() {
    return ["span", { class: "rt-spoiler", "data-spoiler": "true" }, 0];
  },
} satisfies MarkConfig;

/** 全部共享节点规格，供 schema 构建使用。 */
export const sharedNodeSpecs: readonly NodeConfig[] = [
  richImageNodeSpec,
  diceRollNodeSpec,
  novelExcerptNodeSpec,
  mentionNodeSpec,
  replyGateNodeSpec,
  attachmentRefNodeSpec,
  pollRefNodeSpec,
  longTextBlockNodeSpec,
  inlineCommentAnchorNodeSpec,
];

/** 全部共享标记规格。 */
export const sharedMarkSpecs: readonly MarkConfig[] = [spoilerMarkSpec];
