import type { JSONContent } from "@tiptap/core";
import { splitDocumentByChapters } from "./boundaries.js";
import {
  CHAPTER_HEADING_LEVEL,
  chapterLevelOf,
  normalizeChapterHeadings,
  normalizeWithChapterLevel,
} from "./headings.js";
import type { AppendChapterResult, RemoveChapterResult } from "./types.js";

export function replaceChapter(
  document: JSONContent,
  index: number,
  replacement: JSONContent,
): JSONContent {
  const normalized = normalizeChapterHeadings(document);
  const chapter = splitDocumentByChapters(normalized).chapters[index];
  if (!chapter) return normalized;
  const content = [...(normalized.content ?? [])];
  content.splice(chapter.start, chapter.end - chapter.start, ...(replacement.content ?? []));
  // replacement 可能来自编辑器（未经归一化的章节片段，含旧的 H2 章节标题），
  // 因此合并后再归一化一次；第一次归一化已经把原文档的章节标题统一到 H1，
  // 这里只需处理 replacement 自己的层级。
  const merged: JSONContent = { type: "doc", content };
  return normalizeWithChapterLevel(merged, chapterLevelOf(merged));
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

export function removeChapter(document: JSONContent, index: number): RemoveChapterResult {
  const normalized = normalizeChapterHeadings(document);
  const chapter = splitDocumentByChapters(normalized).chapters[index];
  if (!chapter) return { document: normalized, removed: null };
  const content = [...(normalized.content ?? [])];
  content.splice(chapter.start, chapter.end - chapter.start);
  return { document: { type: "doc", content }, removed: chapter };
}
