import type { JSONContent } from "@tiptap/core";
import { CHAPTER_HEADING_LEVEL, hasChapterMarker, normalizeChapterHeadings } from "./headings.js";
import type { ChapterRange, ChapterSection, SplitDocument } from "./types.js";

function collectText(node: JSONContent): string {
  if (node.type === "text" && typeof node.text === "string") return node.text;
  return (node.content ?? []).map(collectText).join("");
}

/** 读取节点上持久化的章节身份；没有（或为空）时返回 null。 */
function chapterIdOf(node: JSONContent): string | null {
  const value = node.attrs?.chapterId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** 标题层级；缺失或非法时按章节层级处理。 */
function headingLevel(node: JSONContent): number {
  const level = node.attrs?.level;
  return typeof level === "number" && Number.isFinite(level) ? level : CHAPTER_HEADING_LEVEL;
}

/**
 * 判断某个标题是否开启新章节。
 *
 * 规则只有一条：**H1** 是章节，H2/H3/H4 都是章内小标题
 * （历史文档的 H2/H3/H4 章节标题会在归一化时升为 H1）。
 * 章节边界由层级决定，不再要求 `chapterStart` 标记：层级调整过程中丢标记
 * 不应该让整片目录消失。
 */
function isChapterBoundary(node: JSONContent): boolean {
  if (node.type !== "heading") return false;
  // H1 才可能是章节，且必须带显式章节标记：没有任何标记的文档仍然是一整章
  // （旧版按 H2 兜底分章已移除——正是它把 H2 小标题变成了章节）。
  return headingLevel(node) === CHAPTER_HEADING_LEVEL && hasChapterMarker(node);
}

/**
 * 使用 H1 边界切分文档；历史文档在切分前先做一次标题层级归一化，
 * 因此老文章（H2 章节）的目录与正文对应关系保持不变。
 */
export function splitDocumentByChapters(document: JSONContent): SplitDocument {
  const normalized = normalizeChapterHeadings(document);
  const content = normalized.content ?? [];
  const chapters: ChapterSection[] = [];
  const lead: JSONContent[] = [];
  let current: ChapterSection | null = null;

  content.forEach((node, index) => {
    if (isChapterBoundary(node)) {
      if (current) current.end = index;
      const chapterId = chapterIdOf(node);
      current = {
        // 身份来自节点属性（创建时铸造一次）；只有尚未落库的历史正文
        // 才回落到按位置推导，且这个回退值不作为新身份来源。
        id: chapterId ?? `chapter-${chapters.length}`,
        title: collectText(node).trim(),
        blocks: [node],
        start: index,
        end: index + 1,
        // 派生位置 ID 不是身份：调用方据此区分「真身份」与「旧文档占位」。
        explicitIdentity: chapterId !== null,
      };
      chapters.push(current);
      return;
    }
    if (current) {
      current.blocks.push(node);
      current.end = index + 1;
    } else {
      lead.push(node);
    }
  });

  if (chapters.length === 0) {
    return {
      lead: [],
      chapters: [
        {
          id: "chapter-0",
          title: "正文",
          blocks: [...content],
          start: 0,
          end: content.length,
          explicitIdentity: false,
        },
      ],
    };
  }
  return { lead, chapters };
}

/**
 * 解析章节在完整文档中的节点范围。
 *
 * 显式持久化的 `chapterId` 优先；**只有整篇正文都还没有显式身份**（旧文档）时，
 * 才允许用服务端目录顺序定位。这是唯一的位置兼容入口：目录顺序必须由服务端查库给出，
 * 调用方不得从章节 ID 反解位置。两路都无法确认时返回 null，调用方必须拒绝写入。
 */
export function resolveChapterRange(
  document: JSONContent,
  chapterId: string,
  chapterOrder?: number | null,
): ChapterRange | null {
  const { chapters } = splitDocumentByChapters(document);
  const exact = chapters.find((chapter) => chapter.explicitIdentity && chapter.id === chapterId);
  if (exact) return { start: exact.start, end: exact.end };
  // 正文里存在别的显式身份，说明这不是一份旧文档：绝不用位置顶替未知身份。
  if (chapters.some((chapter) => chapter.explicitIdentity)) return null;
  if (chapterOrder === null || chapterOrder === undefined) return null;
  if (!Number.isSafeInteger(chapterOrder) || chapterOrder < 0) return null;
  const byOrder = chapters[chapterOrder];
  return byOrder ? { start: byOrder.start, end: byOrder.end } : null;
}

/** 章节在文档中的范围是否合法（用于校验调用方解析出来的区间）。 */
export function isValidChapterRange(document: JSONContent, range: ChapterRange): boolean {
  const length = (document.content ?? []).length;
  return (
    Number.isSafeInteger(range.start) &&
    Number.isSafeInteger(range.end) &&
    range.start >= 0 &&
    range.end > range.start &&
    range.end <= length
  );
}

/** 将章节块转换为修订建议使用的行表示。 */
export function chapterTextLines(blocks: readonly JSONContent[]): string[] {
  return blocks.map(collectText);
}
