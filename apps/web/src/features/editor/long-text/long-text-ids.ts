import { createChapterId, isChapterId } from "@ricetext/document-core";
import type { RichTextNode } from "../../../lib/types";

/**
 * 章节身份在**创建时铸造一次**（`chapter-<uuid>`），此后改名、改正文、移动都不变。
 *
 * 旧版本用「标题 + 正文」的内容哈希当身份，改一个字就换 ID，导入去重与版本归集
 * 都会跟着断掉；现在身份与内容无关，新章一律现铸。
 */
export function createLongTextChapterId(): string {
  return createChapterId();
}

/** 该属性是否已经是合法章节身份（含历史的 `chapter-v1-<hash>` 与位置 ID）。 */
export function isCurrentLongTextChapterId(value: unknown): boolean {
  return isChapterId(value);
}

/** 为新章铸造身份；保留旧签名以免调用方改动。 */
export async function createLongTextChapterIdInDocument(
  _document: RichTextNode,
  _title: string,
  _text: string,
): Promise<string> {
  return createChapterId();
}

/** 为缺少身份的草稿章节补铸一次；已有身份（任何历史格式）保持不变。 */
export async function migrateLongTextChapterIds(
  document: RichTextNode,
): Promise<RichTextNode> {
  const content: RichTextNode[] = [];
  for (const node of document.content ?? []) {
    content.push({
      ...node,
      attrs: {
        ...node.attrs,
        chapterId: isChapterId(node.attrs?.chapterId)
          ? node.attrs!.chapterId
          : createChapterId(),
      },
    });
  }
  return {
    ...document,
    content,
  };
}
