/** 编辑器净化器与 API 校验器共用的富文本文档规则。 */

export const DOCUMENT_NODE_ATTRIBUTES = {
  doc: [],
  paragraph: ["textAlign", "firstLineIndent", "leftIndent"],
  text: [],
  heading: ["level", "textAlign", "chapterStart", "firstLineIndent", "leftIndent"],
  bulletList: [],
  orderedList: ["start", "type"],
  listItem: ["textAlign"],
  blockquote: [],
  codeBlock: ["language"],
  hardBreak: [],
  horizontalRule: [],
  inlineCommentAnchor: ["threadId", "count", "placement"],
  richImage: ["assetId", "src", "alt", "caption", "align", "width"],
  diceRoll: ["rollId", "expression", "rolls", "total", "rerollOf"],
  novelExcerpt: [
    "bookTitle",
    "chapterTitle",
    "author",
    "sourceUrl",
    "variant",
    "readerTime",
    "batteryLevel",
    "pageLabel",
    "progressLabel",
    "headerLabel",
  ],
  mention: ["userId", "name", "resolved", "avatarUrl"],
  replyGate: ["gateId", "prompt"],
  attachmentRef: ["attachmentId", "name", "mimeType", "size", "priceCoins"],
  pollRef: ["pollId", "question", "multiple", "options"],
  longTextBlock: ["chapterId", "title", "volumeTitle", "text", "order", "start", "end"],
  emoji: ["emojiId", "name", "src", "fallback"],
} as const;

export const DOCUMENT_MARK_ATTRIBUTES = {
  bold: [],
  italic: [],
  underline: [],
  strike: [],
  code: [],
  spoiler: [],
  link: ["href", "target", "rel"],
  textStyle: ["color", "fontFamily", "fontSize"],
} as const;

export const ALLOWED_DOCUMENT_FONT_FAMILIES = [
  "system-ui",
  "sans-serif",
  "serif",
  "monospace",
  "Noto Sans SC",
  "Noto Serif SC",
  "Noto Serif SC Variable",
  "Microsoft YaHei",
  "SimSun",
] as const;

/**
 * 可持久化的字号（px）。
 *
 * 上界放到 512：表情与图片都按 em 渲染，把字号调大就能得到整屏大小的表情，
 * 因此不需要再为表情单独维护一套尺寸属性。仍是白名单，避免任意数值导致
 * 每篇正文的呈现不可预期。
 */
export const ALLOWED_DOCUMENT_FONT_SIZES = [
  12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96, 112, 128, 160, 192,
  256, 320, 400, 512,
] as const;

/** 字号白名单的上界；UI 自定义输入按它收窄。 */
export const MAX_DOCUMENT_FONT_SIZE = 512;

/** 字号白名单的下界。 */
export const MIN_DOCUMENT_FONT_SIZE = 12;

export const MAX_DOCUMENT_NODES = 10_000;
export const MAX_DOCUMENT_DEPTH = 32;

export type DocumentNodeType = keyof typeof DOCUMENT_NODE_ATTRIBUTES;
export type DocumentMarkType = keyof typeof DOCUMENT_MARK_ATTRIBUTES;
