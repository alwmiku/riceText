import {
  splitChaptersByStyle,
  type ChapterTitleStyle,
} from "@ricetext/editor-core";
import type { RichTextNode } from "../../../lib/types";
import { createLongTextChapterId } from "./long-text-ids";

/** 将导入的纯文本转换为本地章节节点，避免生成海量普通段落。 */
export async function createLongTextDocument(
  text: string,
  _documentId: string,
  style: ChapterTitleStyle = "auto",
): Promise<RichTextNode> {
  const chapters = splitChaptersByStyle(text, style);
  const content: RichTextNode[] = [];

  for (const chapter of chapters) {
    content.push({
      type: "longTextBlock",
      attrs: {
        // 身份与内容无关：导入时铸造一次，之后改标题或正文都不会换 ID。
        chapterId: createLongTextChapterId(),
        title: chapter.title,
        volumeTitle: chapter.volumeTitle ?? "",
        text: chapter.text,
        order: content.length,
        start: chapter.start,
        end: chapter.end,
      },
    });
  }

  return {
    type: "doc",
    content,
  };
}
