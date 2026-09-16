import type { RichTextNode } from "../../lib/types";
import type { CoverageChapter } from "./chapter-upload-domain";

/** 章节目录的领域投影，展示组件只消费摘要。 */
export interface ChapterSummary {
  id: string;
  title: string;
  volumeTitle?: string;
  charCount: number;
}
import { expandRawRangeToIncludeLeadingTitle } from "../editor/long-text/long-text-ranges";

/** 从完整章节 JSON 提取目录需要的轻量字段，避免侧栏持有正文节点。 */
export function summarizeLongTextChapters(document: RichTextNode): ChapterSummary[] {
  return (document.content ?? []).map((node) => ({
    // 身份只来自节点属性；没有身份的节点由迁移/buildCheckpoint 先补铸，不按位置编造。
    id: String(node.attrs?.chapterId ?? ""),
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
  return (document.content ?? []).map((node) => {
    const text = String(node.attrs?.text ?? "");
    const title = String(node.attrs?.title ?? "未命名章节");
    const rawStart = typeof node.attrs?.start === "number" ? node.attrs.start : null;
    const start = expandRawRangeToIncludeLeadingTitle(rawText, title, rawStart, previousEnd);
    const end = typeof node.attrs?.end === "number" ? node.attrs.end : null;
    if (end !== null) previousEnd = Math.max(previousEnd, end);
    return {
      id: String(node.attrs?.chapterId ?? ""),
      title,
      charCount: text.length,
      start,
      end,
      preview: text.slice(0, 200).replace(/\s+/g, " ").slice(0, 120),
    };
  });
}

/** 编辑器一次只装载一章；按稳定 ID 定位，找不到时返回合法空文档。 */
export function activeLongTextChapter(document: RichTextNode, chapterId: string): RichTextNode {
  const block = (document.content ?? []).find(
    (node) => String(node.attrs?.chapterId) === chapterId,
  );
  return block ? { type: "doc", content: [block] } : { type: "doc", content: [] };
}
