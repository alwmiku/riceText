import type { CoverageChapter } from "./ChapterCoverageDialog";

/** 未切分到任何章节的原文区间。 */
export interface RawGap {
  start: number;
  end: number;
  chars: number;
}

/** 原文分块参数：每块字符数。行高/行数由 @chenglou/pretext 精确测量，不再手工估算。 */
export const BLOCK_CHARS = 2000;

/** 计算全部未切分区间（前导与章节间的空洞）。 */
export function collectRawGaps(chapters: readonly CoverageChapter[]): RawGap[] {
  const gaps: RawGap[] = [];
  let cursor = 0;
  for (const chapter of chapters) {
    if (chapter.start === null || chapter.end === null) continue;
    if (chapter.start > cursor) {
      gaps.push({
        start: cursor,
        end: chapter.start,
        chars: chapter.start - cursor,
      });
    }
    cursor = Math.max(cursor, chapter.end);
  }
  return gaps;
}

/** 原文分块：固定字符数切出的等长片段（末块可能偏短）。 */
export interface RawBlock {
  index: number;
  start: number;
  end: number;
  text: string;
}

/** 原文块内的一个段：纯文本区间 + 章节/空洞标记信息。 */
export interface RawSegment {
  start: number;
  end: number;
  text: string;
  kind: "chapter" | "gap" | "plain";
  markStart: string | null;
  markEnd: string | null;
  gapLabel: string | null;
}

/** 把原文块切为带章节/空洞标记的段（纯文本切分，不含测量）。 */
export function computeBlockSegments(
  block: RawBlock,
  chapter: CoverageChapter | undefined,
  gaps: readonly RawGap[],
  activeIndex: number,
): RawSegment[] {
  const points = new Set<number>([block.start, block.end]);
  if (chapter && chapter.start !== null && chapter.end !== null) {
    if (chapter.start > block.start && chapter.start < block.end)
      points.add(chapter.start);
    if (chapter.end > block.start && chapter.end < block.end)
      points.add(chapter.end);
  }
  for (const gap of gaps) {
    if (gap.start > block.start && gap.start < block.end)
      points.add(gap.start);
    if (gap.end > block.start && gap.end < block.end) points.add(gap.end);
  }

  const sorted = [...points].sort((a, b) => a - b);
  const segments: RawSegment[] = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index] ?? block.start;
    const end = sorted[index + 1] ?? block.end;
    if (end <= start) continue;
    const insideChapter =
      chapter !== undefined &&
      chapter.start !== null &&
      chapter.end !== null &&
      start >= chapter.start &&
      end <= chapter.end;
    const gap = gaps.find((item) => start < item.end && end > item.start);
    segments.push({
      start,
      end,
      text: block.text.slice(start - block.start, end - block.start),
      kind: insideChapter ? "chapter" : gap ? "gap" : "plain",
      markStart:
        chapter && chapter.start === start && chapter.end !== null
          ? `▼ 第 ${activeIndex + 1} 章「${chapter.title}」开始 [${chapter.start.toLocaleString()}, ${chapter.end.toLocaleString()})`
          : null,
      markEnd:
        chapter && chapter.end === end
          ? `▲ 第 ${activeIndex + 1} 章结束`
          : null,
      gapLabel:
        gap && Math.max(gap.start, block.start) === start
          ? `未切分 [${gap.start.toLocaleString()}, ${gap.end.toLocaleString()}) ${gap.chars.toLocaleString()} 字`
          : null,
    });
  }
  if (
    chapter &&
    chapter.end === block.end &&
    segments.length > 0 &&
    segments[segments.length - 1]?.markEnd === null
  ) {
    segments[segments.length - 1] = {
      ...segments[segments.length - 1]!,
      markEnd: `▲ 第 ${activeIndex + 1} 章结束`,
    };
  }
  return segments;
}
