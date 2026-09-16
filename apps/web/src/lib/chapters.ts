/** 兼容入口；章节行为由 document-core 负责。 */
export {
  chapterTextLines,
  createChapterId,
  isChapterId,
  isUsableChapterId,
  removeChapterRange as removeChapterBlocks,
  replaceChapterRange as mergeChapterRange,
  resolveChapterRange,
  splitDocumentByChapters as splitDocumentByHeadings,
} from "@ricetext/document-core";
export type { ChapterRange, ChapterSection, SplitDocument } from "@ricetext/document-core";

import {
  CHAPTER_HEADING_LEVEL,
  createChapterId,
  isUsableChapterId,
  normalizeChapterHeadings,
  splitDocumentByChapters as splitDocumentByHeadings,
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

/** `ensureChapterIdentity` 交给宿主的章节描述；position 只用于兼容旧目录。 */
export interface PendingChapterIdentity {
  /** 章节在正文中的序号（0 基）：只有旧正文才需要用它对齐服务器目录。 */
  position: number;
  title: string;
  start: number;
  end: number;
}

/**
 * 给正文里缺少身份的章节标题补一次身份，并把结果写回正文。
 *
 * 身份来源按优先级取：
 * 1. 节点已携带的身份（含历史的 `chapter-v1-<hash>` 与位置 ID）；
 * 2. `resolveExistingId(章节描述)` 返回的服务器目录 id —— 目录由服务器拥有，
 *    旧正文第一次保存时必须复用它，否则会铸出新身份、让目录行变成孤儿；
 * 3. 现铸一个 `chapter_<uuid>`（服务器目录里还没有这一章）。
 *
 * 只处理顶层章节标题（与 `splitDocumentByChapters` 的分章规则一致）：
 * 章内小标题、嵌套节点里的标题都不会被写入身份。
 * 补铸必须写回正文（`heading.attrs.chapterId`），否则每次保存都会换身份。
 * 返回同一个对象表示无需改动。
 */
export function ensureChapterIdentity<T extends ChapterIdentityNode>(
  document: T,
  resolveExistingId?: ((chapter: PendingChapterIdentity) => string | undefined) | undefined,
): { content: T; changed: boolean } {
  const normalized = normalizeChapterHeadings(document as never) as unknown as T;
  const nodes = (normalized.content ?? []) as ChapterIdentityNode[];
  const sections = splitDocumentByHeadings(normalized as never).chapters;
  let chapterIndex = 0;
  let changed = false;
  const content = nodes.map((node) => {
    if (!isChapterHeading(node)) return node;
    const position = chapterIndex;
    const section = sections[position];
    chapterIndex += 1;
    const carried = node.attrs?.chapterId;
    const assigned = isUsableChapterId(carried)
      ? carried
      : (() => {
          const fromDirectory = section
            ? resolveExistingId?.({
                position,
                title: section.title,
                start: section.start,
                end: section.end,
              })
            : undefined;
          return isUsableChapterId(fromDirectory) ? fromDirectory : createChapterId();
        })();
    if (carried === assigned) return node;
    changed = true;
    return { ...node, attrs: { ...node.attrs, chapterId: assigned } };
  });
  return {
    content: changed ? ({ ...normalized, content } as T) : normalized,
    changed: changed || normalized !== (document as unknown),
  };
}
