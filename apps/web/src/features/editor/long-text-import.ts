import {
  splitChaptersByStyle,
  type ChapterTitleStyle,
} from "@ricetext/editor-core";
import type { RichTextNode } from "../../lib/types";

/** 将导入的纯文本转换为本地章节节点，避免生成海量普通段落。 */
export function createLongTextDocument(
  text: string,
  style: ChapterTitleStyle = "auto",
): RichTextNode {
  const chapters = splitChaptersByStyle(text, style);

  return {
    type: "doc",
    content: chapters.map((chapter, index) => ({
      type: "longTextBlock",
      attrs: {
        chapterId: `local-chapter-${index + 1}`,
        title: chapter.title,
        text: chapter.text,
        order: index,
      },
    })),
  };
}
