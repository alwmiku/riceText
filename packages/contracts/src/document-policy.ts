/** Rich text document policy shared by the editor sanitizer and API validator. */

export const DOCUMENT_NODE_ATTRIBUTES = {
  doc: [],
  paragraph: ["textAlign"],
  text: [],
  heading: ["level", "textAlign", "chapterStart"],
  bulletList: [],
  orderedList: ["start"],
  listItem: ["textAlign"],
  blockquote: [],
  codeBlock: ["language"],
  hardBreak: [],
  horizontalRule: [],
  inlineCommentAnchor: ["threadId", "count", "placement"],
  richImage: ["assetId", "src", "alt", "caption", "align", "width"],
  diceRoll: ["rollId", "expression", "rolls", "total", "rerollOf"],
  novelExcerpt: ["bookTitle", "chapterTitle", "author", "sourceUrl", "variant"],
  mention: ["userId", "name", "resolved", "avatarUrl"],
  replyGate: ["gateId", "prompt"],
  attachmentRef: ["attachmentId", "name", "mimeType", "size", "priceCoins"],
  pollRef: ["pollId", "question", "multiple", "options"],
  longTextBlock: ["chapterId", "title", "text", "order", "start", "end"],
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

export const ALLOWED_DOCUMENT_FONT_SIZES = [
  12,
  14,
  16,
  18,
  20,
  24,
  28,
  32,
  36,
  48,
] as const;

export const MAX_DOCUMENT_NODES = 10_000;
export const MAX_DOCUMENT_DEPTH = 32;

export type DocumentNodeType = keyof typeof DOCUMENT_NODE_ATTRIBUTES;
export type DocumentMarkType = keyof typeof DOCUMENT_MARK_ATTRIBUTES;
