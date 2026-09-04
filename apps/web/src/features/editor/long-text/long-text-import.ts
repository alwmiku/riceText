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
  const occurrences = new Map<string, number>();
  const content: RichTextNode[] = [];

  for (const chapter of chapters) {
    const key = chapter.title.normalize("NFC").trim() + "\0" + chapter.text.replace(/\r\n?/g, "\n").normalize("NFC");
    const duplicateOrdinal = occurrences.get(key) ?? 0;
    occurrences.set(key, duplicateOrdinal + 1);
    content.push({
      type: "longTextBlock",
      attrs: {
        chapterId: await createLongTextChapterId(
          chapter.title,
          chapter.text,
          duplicateOrdinal,
        ),
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
