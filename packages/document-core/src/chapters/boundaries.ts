import type { JSONContent } from "@tiptap/core";
import { CHAPTER_HEADING_LEVEL, hasChapterMarker, normalizeChapterHeadings } from "./headings.js";
import type { ChapterRange, ChapterSection, SplitDocument } from "./types.js";

function collectText(node: JSONContent): string {
  if (node.type === "text" && typeof node.text === "string") return node.text;
  return (node.content ?? []).map(collectText).join("");
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
      current = {
        id: `chapter-${chapters.length}`,
        title: collectText(node).trim(),
        blocks: [node],
        start: index,
        end: index + 1,
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
        },
      ],
    };
  }
  return { lead, chapters };
}

export function getChapterRange(document: JSONContent, index: number): ChapterRange | null {
  const chapter = splitDocumentByChapters(document).chapters[index];
  return chapter ? { start: chapter.start, end: chapter.end } : null;
}

/** 将章节块转换为修订建议使用的行表示。 */
export function chapterTextLines(blocks: readonly JSONContent[]): string[] {
  return blocks.map(collectText);
}
