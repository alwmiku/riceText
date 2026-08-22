import type { JSONContent, Editor } from "@tiptap/core";

import type {
  ReplyGateAttributes,
  RichImageAttributes,
  ViewerImage,
} from "../types.js";
import type { RichTextViewerInteractions, ViewerTocItem } from "./types.js";

interface GalleryData {
  images: ViewerImage[];
}

/** 单次遍历收集图片，保证正文顺序就是灯箱前后顺序。 */
export function collectGallery(document: JSONContent): GalleryData {
  const images: ViewerImage[] = [];
  const visit = (node: JSONContent) => {
    if (node.type === "richImage") {
      const attrs = node.attrs as unknown as RichImageAttributes;
      images.push({ ...attrs, index: images.length });
    }
    node.content?.forEach(visit);
  };
  visit(document);
  return { images };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** 为没有行末间贴锚点的非空段落补一个自动锚点，保持阅读模式的气泡体验。 */
export function addMissingParagraphAnchors(doc: JSONContent): JSONContent {
  const clone = structuredClone(doc);
  const visit = (
    node: JSONContent,
    path: string,
    insideReplyGate = false,
  ): void => {
    const nextInsideReplyGate = insideReplyGate || node.type === "replyGate";
    if (node.type === "paragraph" && !insideReplyGate) {
      const hasEndAnchor =
        node.content?.some(
          (child) =>
            child.type === "inlineCommentAnchor" &&
            child.attrs?.placement === "end",
        ) ?? false;
      const hasVisibleContent =
        node.content?.some((child) => child.type !== "inlineCommentAnchor") ??
        false;
      if (!hasEndAnchor && hasVisibleContent) {
        node.content = [
          ...(node.content ?? []),
          {
            type: "inlineCommentAnchor",
            attrs: { threadId: `auto:${path}`, count: 0, placement: "end" },
          },
        ];
      }
    }
    node.content?.forEach((child, index) =>
      visit(child, `${path}.${index}`, nextInsideReplyGate),
    );
  };
  visit(clone, "0");
  return clone;
}

/** 在 ProseMirror 构建读者 DOM 之前移除被锁定的回复门控子内容。 */
export function projectReplyGates(
  doc: JSONContent,
  interactions: RichTextViewerInteractions,
): JSONContent {
  const clone = structuredClone(doc);
  const visit = (node: JSONContent): void => {
    if (node.type === "replyGate") {
      const attrs = node.attrs as unknown as ReplyGateAttributes;
      if (interactions.isReplyGateVisible?.(attrs) !== true) {
        node.content = [{ type: "paragraph" }];
        return;
      }
    }
    node.content?.forEach(visit);
  };
  visit(clone);
  return clone;
}

/** 按正文顺序收集标题，供目录快速跳转。 */
export function extractHeadings(doc: JSONContent): ViewerTocItem[] {
  const items: ViewerTocItem[] = [];
  const visit = (node: JSONContent): void => {
    if (typeof node.type === "string" && node.type.startsWith("heading")) {
      const level = Number(node.attrs?.level ?? 1);
      const text = (node.content ?? [])
        .map((child) =>
          child.type === "text" && typeof child.text === "string"
            ? child.text
            : "",
        )
        .join("")
        .trim();
      if (text) items.push({ index: items.length, level, text });
    }
    node.content?.forEach(visit);
  };
  visit(doc);
  return items;
}

/** 安全获取 ProseMirror 内容 DOM：Tiptap 在 view 未挂载时访问会抛错。 */
export function getEditorViewDom(editor: Editor): HTMLElement | null {
  try {
    const view = editor.view;
    if (!view) return null;
    return view.dom instanceof HTMLElement ? view.dom : null;
  } catch {
    return null;
  }
}
