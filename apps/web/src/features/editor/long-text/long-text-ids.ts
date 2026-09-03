import { scopedLongTextChapterId } from "@ricetext/document-core";
import type { RichTextNode } from "../../../lib/types";

export const longTextChapterId = scopedLongTextChapterId;

/** 将旧草稿中的非作用域章节 ID 迁移到当前文章，正文和顺序保持不变。 */
export function scopeLongTextChapterIds(
  document: RichTextNode,
  documentId: string,
): RichTextNode {
  return {
    ...document,
    content: (document.content ?? []).map((node, index) => ({
      ...node,
      attrs: {
        ...node.attrs,
        chapterId: scopedLongTextChapterId(
          documentId,
          String(node.attrs?.chapterId ?? `local-chapter-${index + 1}`),
        ),
      },
    })),
  };
}
