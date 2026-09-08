import type { DOMOutputSpec } from "@tiptap/pm/model";
import { sanitizeUrl } from "./sanitize.js";
import { normalizeNovelExcerptVariant } from "./novel-excerpt-variant.js";

// 空气泡属于平台阅读页装饰，不代表论坛评论或回复数量。
export const READER_PLATFORM_POLICY = {
  fanqie: { name: "番茄轻小说", emptyBubble: false },
  qidian: { name: "起点读书", emptyBubble: true },
} as const;

export function currentReaderTime(date = new Date()): string {
  return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
}

export interface ReaderPageState { index: number; count: number }
export function readerPageState(index: number, count: number): ReaderPageState {
  const total = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  return { index: Number.isFinite(index) ? Math.max(0, Math.min(total - 1, Math.floor(index))) : 0, count: total };
}

export function readerBookTitle(value: unknown): string {
  const title = String(value ?? "").trim();
  if (!title) return "";
  return title.startsWith("《") && title.endsWith("》") ? title : "《" + title + "》";
}

export function readerDisplay(attrs: Record<string, unknown>) {
  const qidian = normalizeNovelExcerptVariant(attrs.variant) === "qidian";
  const level = Number(attrs.batteryLevel ?? 100);
  return {
    time: String(attrs.readerTime ?? ""),
    battery: Number.isFinite(level) ? Math.max(0, Math.min(100, Math.round(level))) : 100,
    header: String(attrs.headerLabel || (qidian ? "起点热评" : "00:24得991金币")),
  };
}
function battery(level: number): DOMOutputSpec {
  return ["span", { class: "rt-reader-battery", role: "img", "aria-label": "电量 " + level + "%" },
    ["http://www.w3.org/2000/svg svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 30 14", "aria-hidden": "true" },
      ["rect", { x: 1, y: 1, width: 25, height: 12, rx: 2, fill: "none", stroke: "currentColor", "stroke-width": 1 }],
      ["rect", { x: 3, y: 3, width: 21 * level / 100, height: 8, rx: 0.5, fill: "currentColor" }],
      ["path", { d: "M28 5v4", stroke: "currentColor", "stroke-width": 2 }],
    ],
  ];
}
export function readerTop(attrs: Record<string, unknown>): DOMOutputSpec[] {
  const display = readerDisplay(attrs);
  const url = sanitizeUrl(attrs.sourceUrl, "link");
  const title = readerBookTitle(attrs.bookTitle);
  return [
    ["div", { class: "rt-reader-book-title", contenteditable: "false" },
      url ? ["a", { href: url, target: "_blank", rel: "noopener noreferrer nofollow" }, title] : title],
    ["header", { class: "rt-reader-topline", contenteditable: "false" },
      ["span", { class: "rt-reader-chapter" }, ["i", { class: "rt-reader-back", "aria-hidden": "true" }], String(attrs.chapterTitle || attrs.bookTitle || "")],
      ["span", { class: "rt-reader-header-label", title: display.header }, ["span", { class: "rt-reader-header-text" }, display.header], ...(normalizeNovelExcerptVariant(attrs.variant) === "fanqie" ? [["i", { class: "rt-reader-next", "aria-hidden": "true" }] as DOMOutputSpec] : [])],
    ],
  ];
}
export function readerBottom(attrs: Record<string, unknown>, pagination: ReaderPageState = { index: 0, count: 1 }): DOMOutputSpec {
  const display = readerDisplay(attrs);
  const page = readerPageState(pagination.index, pagination.count);
  return ["footer", { class: "rt-reader-bottomline", contenteditable: "false" },
    ["span", { class: "rt-reader-progress", "aria-live": "polite", "aria-atomic": "true" },
      String(page.index + 1) + "/" + page.count,
      ...(normalizeNovelExcerptVariant(attrs.variant) === "qidian" ? [["span", {}, Math.round((page.index + 1) / page.count * 100) + "%"] as DOMOutputSpec] : [])],
    ["span", { class: "rt-reader-clock" }, display.time, battery(display.battery)],
  ];
}
