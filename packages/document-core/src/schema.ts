import {
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
import { sanitizeUrl } from "./sanitize.js";
import { sharedMarkSpecs, sharedNodeSpecs } from "./nodes.js";

/** {@link createDocumentExtensions} 接受的配置。 */
export interface DocumentExtensionsOptions {
  /** 附加到共享 schema 之后的额外扩展。 */
  additionalExtensions?: Extensions;
}

/**
 * 服务端与编辑器共用的规范扩展清单（无 React 依赖）。
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
      // 与 editor-core 的 Link 配置保持一致，去掉 Tiptap 默认的
      // class/title 属性，保证服务端 schema 与编辑器 schema 完全一致。
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
    Color.configure({ types: ["textStyle"] }),
    FontFamily.configure({ types: ["textStyle"] }),
    FontSize.configure({ types: ["textStyle"] }),
    TextAlign.configure({
      types: ["heading", "paragraph", "listItem"],
      alignments: ["left", "center", "right", "justify"],
    }),
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
