import type { RichTextNode } from "../../../lib/types";
import { sha256Hex } from "../../../lib/utils";

const CHAPTER_ID_PREFIX = "chapter-v1-";

function normalizedParts(title: string, text: string) {
  return {
    title: title.normalize("NFC").trim(),
    text: text.replace(/\r\n?/g, "\n").normalize("NFC"),
  };
}

function identityKey(title: string, text: string): string {
  const normalized = normalizedParts(title, text);
  return normalized.title + "\0" + normalized.text;
}

/** 章节创建时计算一次的稳定身份；后续编辑不会重新计算。 */
export async function createLongTextChapterId(
  title: string,
  text: string,
  duplicateOrdinal = 0,
): Promise<string> {
  const normalized = normalizedParts(title, text);
  const payload =
    "ricetext:chapter:v1\0" +
    normalized.title +
    "\0" +
    normalized.text +
    "\0" +
    String(duplicateOrdinal);
  return CHAPTER_ID_PREFIX + (await sha256Hex(payload));
}

export function isCurrentLongTextChapterId(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^chapter-v1-[0-9a-f]{64}$/.test(value)
  );
}

/** 为新章计算同内容在当前文章中的确定性重复序号。 */
export async function createLongTextChapterIdInDocument(
  document: RichTextNode,
  title: string,
  text: string,
): Promise<string> {
  const key = identityKey(title, text);
  const duplicateOrdinal = (document.content ?? []).filter(
    (node) =>
      identityKey(
        String(node.attrs?.title ?? "未命名章节"),
        String(node.attrs?.text ?? ""),
      ) === key,
  ).length;
  return createLongTextChapterId(title, text, duplicateOrdinal);
}

/** 将旧草稿章节 ID 一次性迁移为内容哈希 ID，已迁移章节保持不变。 */
export async function migrateLongTextChapterIds(
  document: RichTextNode,
): Promise<RichTextNode> {
  const occurrences = new Map<string, number>();
  const content: RichTextNode[] = [];
  for (const node of document.content ?? []) {
    const title = String(node.attrs?.title ?? "未命名章节");
    const text = String(node.attrs?.text ?? "");
    const key = identityKey(title, text);
    const duplicateOrdinal = occurrences.get(key) ?? 0;
    occurrences.set(key, duplicateOrdinal + 1);
    content.push({
      ...node,
      attrs: {
        ...node.attrs,
        chapterId: isCurrentLongTextChapterId(node.attrs?.chapterId)
          ? node.attrs!.chapterId
          : await createLongTextChapterId(title, text, duplicateOrdinal),
      },
    });
  }
  return {
    ...document,
    content,
  };
}
