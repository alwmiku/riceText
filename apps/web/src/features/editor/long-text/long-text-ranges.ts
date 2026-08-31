import { MAX_CHAPTER_LENGTH } from "@ricetext/editor-core";

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface RawRange {
  start: number | null;
  end: number | null;
}

/** 用编辑器内正文切分点，推回导入原文中的章节区间。 */
export function splitRawRangeAtCursor(
  attrs: Record<string, unknown> | undefined,
  before: string,
  after: string,
): { before: RawRange; after: RawRange } {
  const start = numberOrNull(attrs?.start);
  const end = numberOrNull(attrs?.end);
  if (start === null || end === null || end < start) {
    return {
      before: { start: null, end: null },
      after: { start: null, end: null },
    };
  }

  const text = String(attrs?.text ?? "");
  const bodyStart = text.length > 0 ? end - text.length : end - after.length;
  const splitAt = Math.max(start, Math.min(end, bodyStart + before.length));

  return {
    before: { start, end: splitAt },
    after: { start: splitAt, end },
  };
}

/** 从未切分原文创建章节时，保留与实际写入正文一致的原文区间。 */
export function rawRangeForGapChapter(
  start: number | null | undefined,
  end: number | null | undefined,
  text: string,
): RawRange {
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start
  ) {
    return { start: null, end: null };
  }

  return {
    start,
    end: Math.min(end, start + Math.min(text.length, MAX_CHAPTER_LENGTH)),
  };
}

/** 兼容旧导入：超长章首段曾从正文开始，导致标题行被审计为未切分 gap。 */
export function expandRawRangeToIncludeLeadingTitle(
  rawText: string | null,
  title: string,
  start: number | null,
  previousEnd: number,
): number | null {
  if (rawText === null || start === null || start <= previousEnd) return start;
  const normalizedTitle = title.trim();
  if (!normalizedTitle) return start;

  const gap = rawText.slice(previousEnd, start);
  const titleIndex = gap.lastIndexOf(normalizedTitle);
  if (titleIndex < 0) return start;

  const titleEnd = titleIndex + normalizedTitle.length;
  if (gap.slice(0, titleIndex).trim() !== "") return start;
  if (gap.slice(titleEnd).trim() !== "") return start;
  return previousEnd + titleIndex;
}
