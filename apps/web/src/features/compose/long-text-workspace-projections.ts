import type { RichTextNode } from "../../lib/types";
import type { CoverageChapter } from "../novel/ChapterCoverageDialog";
import type { ChapterSummary } from "../novel/ChapterSidebar";
import { expandRawRangeToIncludeLeadingTitle } from "../editor/long-text-ranges";

export function summarizeLongTextChapters(
  document: RichTextNode,
): ChapterSummary[] {
  return (document.content ?? []).map((node, index) => ({
    id: String(node.attrs?.chapterId ?? `chapter-${index}`),
    title: String(node.attrs?.title ?? "未命名章节"),
    charCount: String(node.attrs?.text ?? "").length,
  }));
}

export function mapLongTextCoverage(
  document: RichTextNode,
  rawText: string | null,
): CoverageChapter[] {
  let previousEnd = 0;
  return (document.content ?? []).map((node, index) => {
    const text = String(node.attrs?.text ?? "");
    const title = String(node.attrs?.title ?? "未命名章节");
    const rawStart =
      typeof node.attrs?.start === "number" ? node.attrs.start : null;
    const start = expandRawRangeToIncludeLeadingTitle(
      rawText,
      title,
      rawStart,
      previousEnd,
    );
    const end = typeof node.attrs?.end === "number" ? node.attrs.end : null;
    if (end !== null) previousEnd = Math.max(previousEnd, end);
    return {
      id: String(node.attrs?.chapterId ?? `chapter-${index}`),
      title,
      charCount: text.length,
      start,
      end,
      preview: text.slice(0, 200).replace(/\s+/g, " ").slice(0, 120),
    };
  });
}

export function activeLongTextChapter(
  document: RichTextNode,
  activeIndex: number,
): RichTextNode {
  const block = document.content?.[activeIndex];
  return block
    ? { type: "doc", content: [block] }
    : { type: "doc", content: [] };
}
