import type { DOMOutputSpec } from "@tiptap/pm/model";
import { sanitizeUrl } from "./sanitize.js";
import { normalizeNovelExcerptVariant } from "./novel-excerpt-variant.js";
import { chromeSurface } from "./capabilities.js";
import type { NovelExcerptVariant } from "./types.js";

// 空气泡属于平台阅读页装饰，不代表论坛评论或回复数量。
export const READER_PLATFORM_POLICY = {
  fanqie: {
    name: "番茄轻小说",
    emptyBubble: false,
    defaultBattery: 100,
    headerLabel: "00:24得991金币",
    headerKind: "reward",
  },
  qidian: {
    name: "起点读书",
    emptyBubble: true,
    defaultBattery: 75,
    headerLabel: "起点热评",
    headerKind: "label",
  },
  sfacg: {
    name: "菠萝包轻小说",
    emptyBubble: true,
    defaultBattery: 75,
    headerLabel: "",
    headerKind: "moon",
  },
  ciweimao: {
    name: "刺猬猫阅读",
    emptyBubble: true,
    defaultBattery: 75,
    headerLabel: "",
    headerKind: "none",
  },
} as const satisfies Record<
  NovelExcerptVariant,
  {
    name: string;
    emptyBubble: boolean;
    defaultBattery: number;
    headerLabel: string;
    headerKind: "reward" | "label" | "moon" | "none";
  }
>;

export function currentReaderTime(date = new Date()): string {
  return (
    String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0")
  );
}

export interface ReaderPageState {
  index: number;
  count: number;
}
export function readerPageState(index: number, count: number): ReaderPageState {
  const total = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  return {
    index: Number.isFinite(index) ? Math.max(0, Math.min(total - 1, Math.floor(index))) : 0,
    count: total,
  };
}

export function readerBookTitle(value: unknown): string {
  const title = String(value ?? "").trim();
  if (!title) return "";
  return title.startsWith("《") && title.endsWith("》") ? title : "《" + title + "》";
}

export function readerDisplay(attrs: Record<string, unknown>) {
  const policy = READER_PLATFORM_POLICY[normalizeNovelExcerptVariant(attrs.variant)];
  const level = Number(attrs.batteryLevel ?? 100);
  return {
    time: String(attrs.readerTime ?? ""),
    battery: Number.isFinite(level) ? Math.max(0, Math.min(100, Math.round(level))) : 100,
    header: String(attrs.headerLabel || policy.headerLabel),
  };
}
function battery(level: number): DOMOutputSpec {
  return [
    "span",
    { class: "rt-reader-battery", role: "img", "aria-label": "电量 " + level + "%" },
    [
      "http://www.w3.org/2000/svg svg",
      { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 30 14", "aria-hidden": "true" },
      [
        "rect",
        {
          x: 1,
          y: 1,
          width: 25,
          height: 12,
          rx: 2,
          fill: "none",
          stroke: "currentColor",
          "stroke-width": 1,
        },
      ],
      ["rect", { x: 3, y: 3, width: (21 * level) / 100, height: 8, rx: 0.5, fill: "currentColor" }],
      ["path", { d: "M28 5v4", stroke: "currentColor", "stroke-width": 2 }],
    ],
  ];
}
/** 书名与来源链接只有一份结构，平台决定放在页首或页尾。 */
function bookTitle(attrs: Record<string, unknown>): DOMOutputSpec {
  const url = sanitizeUrl(attrs.sourceUrl, "link");
  const title = readerBookTitle(attrs.bookTitle);
  return [
    "div",
    { class: "rt-reader-book-title", contenteditable: "false", title, ...chromeSurface() },
    url
      ? ["a", { href: url, target: "_blank", rel: "noopener noreferrer nofollow" }, title]
      : title,
  ];
}

export function readerTop(attrs: Record<string, unknown>): DOMOutputSpec[] {
  const variant = normalizeNovelExcerptVariant(attrs.variant);
  const policy = READER_PLATFORM_POLICY[variant];
  const display = readerDisplay(attrs);
  const heading: Array<DOMOutputSpec | string> = [];
  if (variant !== "ciweimao")
    heading.push(["i", { class: "rt-reader-back", "aria-hidden": "true" }]);
  heading.push(String(attrs.chapterTitle || attrs.bookTitle || ""));
  const trailing: DOMOutputSpec[] = [];
  if (policy.headerKind === "moon") {
    trailing.push(["span", { class: "rt-reader-moon", "aria-hidden": "true" }]);
  } else if (policy.headerKind !== "none") {
    trailing.push([
      "span",
      { class: "rt-reader-header-label", title: display.header },
      ["span", { class: "rt-reader-header-text" }, display.header],
      ...(policy.headerKind === "reward"
        ? [["i", { class: "rt-reader-next", "aria-hidden": "true" }] as DOMOutputSpec]
        : []),
    ]);
  }
  return [
    ...(variant === "sfacg" ? [] : [bookTitle(attrs)]),
    [
      "header",
      { class: "rt-reader-topline", contenteditable: "false", ...chromeSurface() },
      ["span", { class: "rt-reader-chapter" }, ...heading],
      ...trailing,
    ],
  ];
}

export function readerBottom(
  attrs: Record<string, unknown>,
  pagination: ReaderPageState = { index: 0, count: 1 },
): DOMOutputSpec {
  const variant = normalizeNovelExcerptVariant(attrs.variant);
  const display = readerDisplay(attrs);
  const page = readerPageState(pagination.index, pagination.count);
  const percent = ((page.index + 1) / page.count) * 100;
  const pageLabel = String(page.index + 1) + "/" + page.count;
  const progress: DOMOutputSpec = [
    "span",
    { class: "rt-reader-progress", "aria-live": "polite", "aria-atomic": "true" },
    pageLabel,
    ...(variant === "qidian" || variant === "ciweimao"
      ? [
          [
            "span",
            { class: "rt-reader-percentage" },
            (variant === "ciweimao" ? percent.toFixed(2) : Math.round(percent)) + "%",
          ] as DOMOutputSpec,
        ]
      : []),
  ];
  const clock: DOMOutputSpec = [
    "span",
    { class: "rt-reader-clock" },
    ...(variant === "sfacg"
      ? [battery(display.battery), display.time]
      : [display.time, battery(display.battery)]),
  ];
  const children: DOMOutputSpec[] =
    variant === "sfacg"
      ? [
          clock,
          [
            "div",
            { class: "rt-reader-book-meta" },
            bookTitle(attrs),
            ["span", { class: "rt-reader-percentage" }, Math.round(percent) + "%"],
          ],
          progress,
        ]
      : [
          progress,
          // 来源阅读器的底栏装饰不提供弹幕功能，也不参与摘录翻页。
          ...(variant === "ciweimao"
            ? [
                [
                  "span",
                  { class: "rt-reader-danmaku", "aria-hidden": "true" },
                  "开启弹幕",
                  ["i", { class: "rt-reader-chevron-up" }],
                ] as DOMOutputSpec,
              ]
            : []),
          clock,
        ];
  return [
    "footer",
    { class: "rt-reader-bottomline", contenteditable: "false", ...chromeSurface() },
    ...children,
  ];
}
