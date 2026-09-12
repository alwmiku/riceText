import type { JSONContent } from "@tiptap/core";
import { CHAPTER_HEADING_LEVEL } from "./headings.js";

function paragraph(text: string): JSONContent {
  return {
    type: "paragraph",
    attrs: { textAlign: "left" },
    ...(text ? { content: [{ type: "text", text }] } : {}),
  };
}

/**
 * 将仅供本地工作台使用的 longTextBlock 展开成标准章节节点。
 * 一行对应一个段落；空行和末尾换行均保留为空段落。
 */
export function convertLongTextBlocksToChapters(document: JSONContent): JSONContent {
  const content = (document.content ?? []).flatMap((node) => {
    if (node.type !== "longTextBlock") return [node];
    const title = String(node.attrs?.title ?? "未命名章节").trim() || "未命名章节";
    const text = String(node.attrs?.text ?? "").replace(/\r\n?/g, "\n");
    const lines = text.split("\n");
    return [
      {
        type: "heading",
        // H1 是唯一的分章层级；长文本工作台产出的章节标题同样固定为 H1。
        attrs: { textAlign: "left", chapterStart: true, level: CHAPTER_HEADING_LEVEL },
        content: [{ type: "text", text: title }],
      },
      ...lines.map(paragraph),
    ];
  });
  return { ...document, type: "doc", content };
}

export function containsLongTextBlocks(document: JSONContent): boolean {
  return (document.content ?? []).some((node) => node.type === "longTextBlock");
}
