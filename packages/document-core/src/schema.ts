import {
  Extension,
  getSchema,
  Mark,
  Node,
  type Extensions,
} from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { Color } from "@tiptap/extension-color";
import { FontFamily } from "@tiptap/extension-font-family";
import { Link } from "@tiptap/extension-link";
import { TextAlign } from "@tiptap/extension-text-align";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import { Underline } from "@tiptap/extension-underline";
import { StarterKit } from "@tiptap/starter-kit";
import {
  ALLOWED_FONT_FAMILIES,
  sanitizeColor,
  sanitizeFontSize,
  sanitizeUrl,
} from "./sanitize.js";
import { sharedMarkSpecs, sharedNodeSpecs } from "./nodes.js";
import { ParagraphIndentAttributes } from "./paragraph-indent.js";

/** {@link createDocumentExtensions} 接受的配置。 */
export interface DocumentExtensionsOptions {
  /** 附加到共享 schema 之后的额外扩展。 */
  additionalExtensions?: Extensions;
}

/**
 * 章节起始标记：挂在 heading 节点上的布尔属性（chapterStart）。
 * 章节目录只把带此标记的标题视为章节边界，正文内的普通 H1/H2
 * 只是排版标题，不会再被切分成新章节。旧文档（无任何标记）仍按
 * 二级标题兜底切分，保证历史数据行为不变。
 */
export const chapterStartExtension = Extension.create({
  name: "chapterStart",
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          chapterStart: {
            default: false,
            parseHTML: (element) =>
              element.getAttribute("data-chapter-start") === "true",
            renderHTML: (attributes) =>
              attributes.chapterStart ? { "data-chapter-start": "true" } : {},
          },
        },
      },
    ];
  },
});

function parseAllowedFontFamily(element: HTMLElement): string | null {
  const raw = element.style.fontFamily?.trim() ?? "";
  if (!raw) return null;
  const firstFamily =
    raw
      .split(",")[0]
      ?.trim()
      .replace(/^["']+|["']+$/g, "") ?? "";
  return (ALLOWED_FONT_FAMILIES as readonly string[]).includes(firstFamily)
    ? firstFamily
    : null;
}

function parseAllowedFontSize(element: HTMLElement): string | null {
  const raw = element.style.fontSize?.trim() ?? "";
  const match = raw.match(/^(\d+)px$/u);
  if (!match) return null;
  return sanitizeFontSize(match[1]);
}

/**
 * 服务端与编辑器共用的唯一持久化基础扩展清单（无 React 依赖）。
 * 自定义节点/标记来自 {@link sharedNodeSpecs}/{@link sharedMarkSpecs}，
 * 与 editor-core 的 UI 扩展消费同一批规格常量。
 */
export function createDocumentExtensions(
  options: DocumentExtensionsOptions = {},
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
    }).extend({
      // 持久化契约（DOCUMENT_MARK_ATTRIBUTES）只接受 href/target/rel：
      // 去掉 Tiptap 默认的 class/title，编辑器直接复用这里的定义。
      addAttributes() {
        return {
          href: {
            default: null,
            parseHTML: (element) => element.getAttribute("href"),
          },
          target: { default: this.options.HTMLAttributes.target ?? null },
          rel: { default: this.options.HTMLAttributes.rel ?? null },
        };
      },
    }),
    TextStyle,
    Color.extend({
      addGlobalAttributes() {
        return [
          {
            types: this.options.types,
            attributes: {
              color: {
                default: null,
                parseHTML: (element) =>
                  sanitizeColor(element.style.color ?? ""),
                renderHTML: (attributes) =>
                  attributes.color
                    ? { style: `color: ${attributes.color}` }
                    : {},
              },
            },
          },
        ];
      },
    }).configure({ types: ["textStyle"] }),
    FontFamily.extend({
      addGlobalAttributes() {
        return [
          {
            types: this.options.types,
            attributes: {
              fontFamily: {
                default: null,
                parseHTML: (element) => parseAllowedFontFamily(element),
                renderHTML: (attributes) =>
                  attributes.fontFamily
                    ? { style: `font-family: ${attributes.fontFamily}` }
                    : {},
              },
            },
          },
        ];
      },
    }).configure({ types: ["textStyle"] }),
    FontSize.extend({
      addGlobalAttributes() {
        return [
          {
            types: this.options.types,
            attributes: {
              fontSize: {
                default: null,
                parseHTML: (element) => parseAllowedFontSize(element),
                renderHTML: (attributes) =>
                  attributes.fontSize
                    ? { style: `font-size: ${attributes.fontSize}` }
                    : {},
              },
            },
          },
        ];
      },
    }).configure({ types: ["textStyle"] }),
    TextAlign.configure({
      types: ["heading", "paragraph", "listItem"],
      alignments: ["left", "center", "right", "justify"],
    }),
    chapterStartExtension,
    ParagraphIndentAttributes,
    ...sharedNodeSpecs.map((spec) => Node.create(spec)),
    ...sharedMarkSpecs.map((spec) => Mark.create(spec)),
    ...(options.additionalExtensions ?? []),
  ];
}

/** 构建规范 ProseMirror schema；服务端应用 steps 与客户端编辑器共用。 */
export function createDocumentSchema(
  options: DocumentExtensionsOptions = {},
): Schema {
  return getSchema(createDocumentExtensions(options));
}
