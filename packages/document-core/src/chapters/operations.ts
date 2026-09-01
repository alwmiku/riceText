import type { JSONContent } from "@tiptap/core";
import { splitDocumentByChapters } from "./boundaries.js";
import type { AppendChapterResult, RemoveChapterResult } from "./types.js";

export function replaceChapter(
  document: JSONContent,
  index: number,
  replacement: JSONContent,
): JSONContent {
  const chapter = splitDocumentByChapters(document).chapters[index];
  if (!chapter) return document;
  const content = [...(document.content ?? [])];
  content.splice(
    chapter.start,
    chapter.end - chapter.start,
    ...(replacement.content ?? []),
  );
  return { type: "doc", content };
}

function migrateLegacyBoundaries(content: readonly JSONContent[]): JSONContent[] {
  const hasExplicitMarkers = content.some(
    (node) => node.type === "heading" && node.attrs?.chapterStart === true,
  );
  if (hasExplicitMarkers) return [...content];
  return content.map((node) =>
    node.type === "heading" && node.attrs?.level === 2
      ? { ...node, attrs: { ...node.attrs, chapterStart: true } }
      : node,
  );
}

export function appendChapter(
  document: JSONContent,
  title: string,
): AppendChapterResult {
  const content = migrateLegacyBoundaries(document.content ?? []);
  const index = splitDocumentByChapters({ type: "doc", content }).chapters.length;
  const heading: JSONContent = {
    type: "heading",
    attrs: { level: 2, chapterStart: true },
    content: [{ type: "text", text: title }],
  };
  const nextDocument: JSONContent = {
    type: "doc",
    content: [...content, heading, { type: "paragraph", content: [] }],
  };
  const chapter = splitDocumentByChapters(nextDocument).chapters[index]!;
  return { document: nextDocument, chapter, index };
}

export function removeChapter(
  document: JSONContent,
  index: number,
): RemoveChapterResult {
  const chapter = splitDocumentByChapters(document).chapters[index];
  if (!chapter) return { document, removed: null };
  const content = [...(document.content ?? [])];
  content.splice(chapter.start, chapter.end - chapter.start);
  return { document: { type: "doc", content }, removed: chapter };
}
