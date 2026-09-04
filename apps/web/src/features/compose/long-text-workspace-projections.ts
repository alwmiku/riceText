import type { RichTextNode } from "../../lib/types";
import type { CoverageChapter } from "../novel/ChapterCoverageDialog";
import type { ChapterSummary } from "../novel/ChapterSidebar";
import { expandRawRangeToIncludeLeadingTitle } from "../editor/long-text/long-text-ranges";

/** 从完整章节 JSON 提取目录需要的轻量字段，避免侧栏持有正文节点。 */
export function summarizeLongTextChapters(
  document: RichTextNode,
): ChapterSummary[] {
  return (document.content ?? []).map((node, index) => ({
    id: String(node.attrs?.chapterId ?? `chapter-${index}`),
    title: String(node.attrs?.title ?? "未命名章节"),
    volumeTitle: String(node.attrs?.volumeTitle ?? ""),
    charCount: String(node.attrs?.text ?? "").length,
  }));
}

/** 把章节保存的原文区间转换为覆盖率视图，并补齐标题所在的前导区间。 */
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

/** 编辑器一次只装载一章；不存在的索引返回合法空文档。 */
export function activeLongTextChapter(
  document: RichTextNode,
  activeIndex: number,
): RichTextNode {
  const block = document.content?.[activeIndex];
  return block
    ? { type: "doc", content: [block] }
    : { type: "doc", content: [] };
}
