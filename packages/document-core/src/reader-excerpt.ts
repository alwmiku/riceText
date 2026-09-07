import type { DOMOutputSpec } from "@tiptap/pm/model";
import { sanitizeUrl } from "./sanitize.js";

// Empty comment markers are platform chrome, never forum threads or counts.
export const READER_PLATFORM_POLICY = {
  fanqie: { name: "番茄轻小说", emptyBubble: false },
  qidian: { name: "起点读书", emptyBubble: true },
} as const;
export function isReaderPlatform(value: unknown): value is keyof typeof READER_PLATFORM_POLICY {
  return value === "fanqie" || value === "qidian";
}

export function readerDisplay(attrs: Record<string, unknown>) {
  const qidian = attrs.variant === "qidian";
  const level = Number(attrs.batteryLevel ?? 100);
  return {
    time: String(attrs.readerTime ?? (qidian ? "10:18" : "13:59")),
    battery: Number.isFinite(level) ? Math.max(0, Math.min(100, Math.round(level))) : 100,
    page: String(attrs.pageLabel ?? (qidian ? "2/20" : "16/843")),
    progress: String(attrs.progressLabel ?? ""),
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
  return [
    ["div", { class: "rt-reader-book-title", contenteditable: "false" }, String(attrs.bookTitle ?? "")],
    ["header", { class: "rt-reader-topline", contenteditable: "false" },
      ["span", { class: "rt-reader-chapter" }, ["i", { class: "rt-reader-back", "aria-hidden": "true" }], String(attrs.chapterTitle || attrs.bookTitle || "")],
      ["span", { class: "rt-reader-header-label" }, display.header, ...(attrs.variant === "fanqie" ? [["i", { class: "rt-reader-next", "aria-hidden": "true" }] as DOMOutputSpec] : [])],
    ],
  ];
}
export function readerBottom(attrs: Record<string, unknown>): DOMOutputSpec {
  const display = readerDisplay(attrs);
  return ["footer", { class: "rt-reader-bottomline", contenteditable: "false" },
    ["span", { class: "rt-reader-progress" }, display.page, ...(display.progress ? [["span", {}, display.progress] as DOMOutputSpec] : [])],
    ["span", { class: "rt-reader-clock" }, display.time, battery(display.battery)],
  ];
}
export function readerAttribution(attrs: Record<string, unknown>): DOMOutputSpec {
  const platform = isReaderPlatform(attrs.variant) ? READER_PLATFORM_POLICY[attrs.variant].name : "";
  const url = sanitizeUrl(attrs.sourceUrl, "link");
  const caption = [platform, attrs.bookTitle, attrs.author].filter(Boolean).join(" · ");
  return ["div", { class: "rt-reader-attribution", contenteditable: "false" },
    url ? ["a", { href: url, target: "_blank", rel: "noopener noreferrer nofollow" }, caption] : ["span", {}, caption],
  ];
}
