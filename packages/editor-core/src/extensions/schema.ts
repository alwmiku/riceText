import { type Extensions } from "@tiptap/core";
import { chapterStartExtension } from "@ricetext/document-core";
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
} from "../sanitize.js";
import { AttachmentRef } from "./attachment-ref.js";
import { DiceRoll } from "./dice-roll.js";
import { InlineCommentAnchorSchema } from "./inline-comment-anchor-schema.js";
import { LongTextBlockSchema } from "./long-text-block-schema.js";
import { Mention } from "./mention.js";
import { NovelExcerpt } from "./novel-excerpt.js";
import { PollRefSchema } from "./poll-ref-schema.js";
import { ReplyGate } from "./reply-gate.js";
import { RichImageSchema } from "./rich-image-schema.js";
import { Spoiler } from "./spoiler.js";

export interface SchemaExtensionsOptions {
  /** Extensions appended after the canonical persisted node and mark set. */
  additionalExtensions?: Extensions;
}

function parseAllowedFontFamily(element: HTMLElement): string | null {
  const raw = element.style.fontFamily?.trim() ?? "";
  if (!raw) return null;
  const firstFamily = raw.split(",")[0]?.trim().replace(/^["']+|["']+$/g, "") ?? "";
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


/** Creates the canonical persisted Tiptap node and mark composition without editor UI behavior. */
export function schemaExtensions(
  options: SchemaExtensionsOptions = {},
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
        return [{
          types: this.options.types,
          attributes: {
            color: {
              default: null,
              parseHTML: (element) => sanitizeColor(element.style.color ?? ""),
              renderHTML: (attributes) => attributes.color
                ? { style: `color: ${attributes.color}` }
                : {},
            },
          },
        }];
      },
    }).configure({ types: ["textStyle"] }),
    FontFamily.extend({
      addGlobalAttributes() {
        return [{
          types: this.options.types,
          attributes: {
            fontFamily: {
              default: null,
              parseHTML: (element) => parseAllowedFontFamily(element),
              renderHTML: (attributes) => attributes.fontFamily
                ? { style: `font-family: ${attributes.fontFamily}` }
                : {},
            },
          },
        }];
      },
    }).configure({ types: ["textStyle"] }),
    FontSize.extend({
      addGlobalAttributes() {
        return [{
          types: this.options.types,
          attributes: {
            fontSize: {
              default: null,
              parseHTML: (element) => parseAllowedFontSize(element),
              renderHTML: (attributes) => attributes.fontSize
                ? { style: `font-size: ${attributes.fontSize}` }
                : {},
            },
          },
        }];
      },
    }).configure({ types: ["textStyle"] }),
    TextAlign.configure({
      types: ["heading", "paragraph", "listItem"],
      alignments: ["left", "center", "right", "justify"],
    }),
    chapterStartExtension,
    InlineCommentAnchorSchema,
    RichImageSchema,
    DiceRoll,
    NovelExcerpt,
    Mention,
    ReplyGate,
    AttachmentRef,
    PollRefSchema,
    LongTextBlockSchema,
    Spoiler,
    ...(options.additionalExtensions ?? []),
  ];
}
