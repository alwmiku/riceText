/** 兼容入口；章节行为由 document-core 负责。 */
export {
  chapterTextLines,
  createChapterId,
  isChapterId,
  isUsableChapterId,
  replaceChapter as mergeChapter,
  splitDocumentByChapters as splitDocumentByHeadings,
} from "@ricetext/document-core";
export type { ChapterSection, SplitDocument } from "@ricetext/document-core";

import {
  CHAPTER_HEADING_LEVEL,
  createChapterId,
  isUsableChapterId,
  normalizeChapterHeadings,
} from "@ricetext/document-core";

/** 最小可遍历的文档节点形状（避免把 Tiptap 类型泄漏到工具层）。 */
interface ChapterIdentityNode {
  type?: string;
  attrs?: Record<string, unknown> | undefined;
  content?: ChapterIdentityNode[] | undefined;
}

/** 与切分规则一致：只有 H1 + chapterStart 的标题才是章节边界。 */
function isChapterHeading(node: ChapterIdentityNode): boolean {
  if (node.type !== "heading") return false;
  const level = node.attrs?.level;
  return (
    (typeof level === "number" && Number.isFinite(level) ? level : CHAPTER_HEADING_LEVEL) ===
      CHAPTER_HEADING_LEVEL && node.attrs?.chapterStart === true
  );
}

/**
 * 给正文里缺少身份的章节标题补一次身份，并把结果写回正文。
 *
 * 身份来源按优先级取：
 * 1. 节点已携带的身份（含历史的 `chapter-v1-<hash>` 与位置 ID）；
 * 2. `resolveExistingId(章节位置)` 返回的服务器目录 id —— 目录由服务器拥有，
 *    旧正文第一次保存时必须复用它，否则会铸出新身份、让目录行变成孤儿；
 * 3. 现铸一个 `chapter_<uuid>`（服务器目录里还没有这一章）。
 *
 * 只处理章节标题本身：没有 H1 章节的正文保持原样，避免把章节属性写到段落上。
 * 补铸必须写回正文（`heading.attrs.chapterId`），否则每次保存都会换身份。
 * 返回同一个对象表示无需改动。
 */
export function ensureChapterIdentity<T extends ChapterIdentityNode>(
  document: T,
  resolveExistingId?: ((chapterIndex: number) => string | undefined) | undefined,
): { content: T; changed: boolean } {
  let chapterIndex = 0;
  let changed = false;
  const normalized = normalizeChapterHeadings(document as never) as unknown as T;
  const visit = (node: ChapterIdentityNode): ChapterIdentityNode => {
    let next = node;
    if (isChapterHeading(node)) {
      const carried = node.attrs?.chapterId;
      const assigned = isUsableChapterId(carried)
        ? carried
        : (() => {
            const fromDirectory = resolveExistingId?.(chapterIndex);
            return isUsableChapterId(fromDirectory) ? fromDirectory : createChapterId();
          })();
      chapterIndex += 1;
      if (carried !== assigned) {
        next = { ...node, attrs: { ...node.attrs, chapterId: assigned } };
        changed = true;
      }
    }
    const children = next.content;
    if (children) {
      const visited = children.map(visit);
      if (visited.some((child, index) => child !== children[index])) {
        next = { ...next, content: visited };
        changed = true;
      }
    }
    return next;
  };
  const content = visit(normalized) as T;
  return { content, changed: changed || content !== (document as unknown) };
}
