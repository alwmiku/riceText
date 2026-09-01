import type { JSONContent } from "@tiptap/core";
import type { ChapterRange, ChapterSection, SplitDocument } from "./types.js";

function collectText(node: JSONContent): string {
  if (node.type === "text" && typeof node.text === "string") return node.text;
  return (node.content ?? []).map(collectText).join("");
}

function hasExplicitChapterMarkers(content: readonly JSONContent[]): boolean {
  return content.some(
    (node) => node.type === "heading" && node.attrs?.chapterStart === true,
  );
}

function isChapterBoundary(node: JSONContent, explicitMarkers: boolean): boolean {
  if (node.type !== "heading") return false;
  return explicitMarkers
    ? node.attrs?.chapterStart === true
    : node.attrs?.level === 2;
}

/** Split a document using explicit chapter markers, with legacy h2 fallback. */
export function splitDocumentByChapters(document: JSONContent): SplitDocument {
  const content = document.content ?? [];
  const explicitMarkers = hasExplicitChapterMarkers(content);
  const chapters: ChapterSection[] = [];
  const lead: JSONContent[] = [];
  let current: ChapterSection | null = null;

  content.forEach((node, index) => {
    if (isChapterBoundary(node, explicitMarkers)) {
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

export function getChapterRange(
  document: JSONContent,
  index: number,
): ChapterRange | null {
  const chapter = splitDocumentByChapters(document).chapters[index];
  return chapter ? { start: chapter.start, end: chapter.end } : null;
}

/** Convert chapter blocks to the line convention used by suggestions. */
export function chapterTextLines(blocks: readonly JSONContent[]): string[] {
  return blocks.map(collectText);
}
