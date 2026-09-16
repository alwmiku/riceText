import type { JSONContent } from "@tiptap/core";
import { isValidChapterRange, splitDocumentByChapters } from "./boundaries.js";
import {
  CHAPTER_HEADING_LEVEL,
  chapterLevelOf,
  hasChapterMarker,
  normalizeChapterHeadings,
  normalizeWithChapterLevel,
} from "./headings.js";
import type { AppendChapterResult, ChapterRange } from "./types.js";

/**
 * 用 replacement 的内容替换文档中已解析的章节范围。
 *
 * 范围只能来自 `resolveChapterRange`（显式 chapterId 优先，旧文档才允许按服务端
 * 目录顺序定位）：命令边界不接受位置参数，范围非法时返回 null，调用方必须拒绝写入，
 * 而不是猜测第一个章节。
 */
export function replaceChapterRange(
  document: JSONContent,
  range: ChapterRange,
  replacement: JSONContent,
  chapterId?: string,
): JSONContent | null {
  const normalized = normalizeChapterHeadings(document);
  if (!isValidChapterRange(normalized, range)) return null;
  const content = [...(normalized.content ?? [])];
  const blocks = [...(replacement.content ?? [])];
  // replacement 可能来自编辑器草稿或历史快照：身份以调用方指定为准，
  // 绝不让一个缺身份或带旧身份的标题块静默顶替目标章节。
  if (chapterId) claimChapterIdentity(blocks, chapterId);
  content.splice(range.start, range.end - range.start, ...blocks);
  const merged: JSONContent = { type: "doc", content };
  return normalizeWithChapterLevel(merged, chapterLevelOf(merged));
}

/** 删除文档中已解析的章节范围；范围非法时返回 null。 */
export function removeChapterRange(
  document: JSONContent,
  range: ChapterRange,
): JSONContent | null {
  const normalized = normalizeChapterHeadings(document);
  if (!isValidChapterRange(normalized, range)) return null;
  const content = [...(normalized.content ?? [])];
  content.splice(range.start, range.end - range.start);
  return { type: "doc", content };
}

/** 章节身份由调用方指定：替换块的首个章节标题必须携带目标 chapterId。 */
function claimChapterIdentity(blocks: JSONContent[], chapterId: string): void {
  const index = blocks.findIndex((node) => node.type === "heading" && hasChapterMarker(node));
  if (index < 0) return;
  const heading = blocks[index]!;
  blocks[index] = { ...heading, attrs: { ...heading.attrs, chapterId } };
}

/**
 * 在文档末尾追加一个新章节。
 *
 * 新章节标题统一是 **H1 + chapterStart**（H1 是唯一的分章层级）；历史文档
 * 先做一次层级归一化，避免把旧的 H2 章节标题留在「章内小标题」位置上。
 */
export function appendChapter(document: JSONContent, title: string): AppendChapterResult {
  const heading: JSONContent = {
    type: "heading",
    attrs: { level: CHAPTER_HEADING_LEVEL, chapterStart: true },
    content: [{ type: "text", text: title }],
  };
  // 先按原文档的历史章节层级归一化，再追加新章节，最后整体归一化一次：
  // 这样旧章节标题升到 H1、小标题按深度落位，新标题也不会被二次搬运。
  const sourceChapterLevel = chapterLevelOf(document);
  const normalized =
    sourceChapterLevel === null
      ? // 没有任何章节标题的文档本身就是一整章（标题由宿主决定）：先给它补一个
        // 章节标题，否则追加的新标题会被当成「全文唯一的章节」，两章会合并成一章。
        firstHeadingAsChapter(document)
      : normalizeWithChapterLevel(document, sourceChapterLevel);
  const withChapter = normalizeWithChapterLevel(
    {
      type: "doc",
      content: [...(normalized.content ?? []), heading, { type: "paragraph", content: [] }],
    },
    sourceChapterLevel,
  );
  const nextDocument = normalizeWithChapterLevel(withChapter, CHAPTER_HEADING_LEVEL);
  const index = splitDocumentByChapters(nextDocument).chapters.length - 1;
  const chapter = splitDocumentByChapters(nextDocument).chapters[index]!;
  return { document: nextDocument, chapter, index };
}

/** 把首个标题升级成章节标题；没有标题时在最前面插入一个空章节标题。 */
function firstHeadingAsChapter(document: JSONContent): JSONContent {
  const content = [...(document.content ?? [])];
  const index = content.findIndex((node) => node.type === "heading");
  if (index >= 0) {
    content[index] = promoteHeading(content[index]!);
  } else {
    content.unshift(promoteHeading({ type: "heading" }));
  }
  return { ...document, type: "doc", content };
}

function promoteHeading(node: JSONContent): JSONContent {
  return {
    ...node,
    attrs: {
      ...node.attrs,
      level: CHAPTER_HEADING_LEVEL,
      chapterStart: true,
    },
  };
}
