import { splitChapters } from "@ricetext/editor-core";
import type { RichTextNode } from "../../lib/types";

/** 将导入的纯文本转换为长文本章节节点，避免生成海量普通段落。 */
export function createLongTextDocument(text: string): RichTextNode {
  const chapters = splitChapters(text);

  return {
    type: "doc",
    content: chapters.map((chapter, index) => ({
      type: "longTextBlock",
      attrs: {
        chapterId: `imported-chapter-${index + 1}`,
        title: chapter.title,
        text: chapter.text,
        order: index,
      },
    })),
  };
}
