import { useMemo, useState } from "react";
import { analyzeCoverage, type CoverageChapter } from "./ChapterCoverageDialog";

/** 未切分到任何章节的原文区间。 */
export interface RawGap {
  start: number;
  end: number;
  chars: number;
}

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

interface Segment {
  kind: "chapter" | "gap" | "context";
  text: string;
}

/**
 * 中间原文对照列：显示当前章节在原文中的切割区间与起止标记，
 * 未切分文字（空洞）以红色展示，像 diff 一样直观可审计。
 */
export function ChapterRawPreview({
  rawText,
  chapters,
  activeIndex,
}: {
  rawText: string | null;
  chapters: readonly CoverageChapter[];
  activeIndex: number;
}) {
  const [focusedGap, setFocusedGap] = useState<number | null>(null);
  const analysis = useMemo(() => analyzeCoverage(chapters), [chapters]);
  const gaps = useMemo(() => collectRawGaps(chapters), [chapters]);

  const chapter = chapters[activeIndex];
  const content = useMemo<{
    segments: Segment[];
    markStart: string | null;
    markEnd: string | null;
    info: string;
  }>(() => {
    if (!rawText)
      return {
        segments: [],
        markStart: null,
        markEnd: null,
        info: "无原文数据",
      };
    if (!chapter)
      return {
        segments: [],
        markStart: null,
        markEnd: null,
        info: "请选择章节",
      };
    if (chapter.start === null || chapter.end === null) {
      return {
        segments: [],
        markStart: null,
        markEnd: null,
        info: "手动添加的章节：无原文区间，不参与切割对照",
      };
    }

    // 聚焦某个未切分空洞：显示该空洞及前后各 200 字。
    if (focusedGap !== null) {
      const gap = gaps[focusedGap];
      if (gap) {
        const from = Math.max(0, gap.start - 200);
        const to = Math.min(rawText.length, gap.end + 200);
        return {
          segments: [
            { kind: "context", text: rawText.slice(from, gap.start) },
            { kind: "gap", text: rawText.slice(gap.start, gap.end) },
            { kind: "context", text: rawText.slice(gap.end, to) },
          ],
          markStart: `未切分区间 [${gap.start.toLocaleString()}, ${gap.end.toLocaleString()})`,
          markEnd: `共 ${gap.chars.toLocaleString()} 字未进入任何章节`,
          info: "聚焦未切分区间",
        };
      }
    }

    const previous = chapters[activeIndex - 1] as CoverageChapter | undefined;
    const next = chapters[activeIndex + 1] as CoverageChapter | undefined;
    const displayStart = previous?.end ?? chapter.start;
    const displayEnd = Math.min(rawText.length, next?.start ?? chapter.end);

    const segments: Segment[] = [];
    const contextBefore = Math.max(
      displayStart,
      Math.max(0, chapter.start - 200),
    );
    const contextAfter = Math.min(
      displayEnd,
      Math.min(rawText.length, chapter.end + 200),
    );

    if (contextBefore < chapter.start) {
      const head = rawText.slice(contextBefore, chapter.start);
      const hasGap =
        previous && previous.end !== null && previous.end < chapter.start;
      segments.push({ kind: hasGap ? "gap" : "context", text: head });
    }
    segments.push({
      kind: "chapter",
      text: rawText.slice(chapter.start, chapter.end),
    });
    if (chapter.end < contextAfter) {
      const tail = rawText.slice(chapter.end, contextAfter);
      const hasGap = next && next.start !== null && next.start > chapter.end;
      segments.push({ kind: hasGap ? "gap" : "context", text: tail });
    }

    return {
      segments,
      markStart: `▼ 第 ${activeIndex + 1} 章「${chapter.title}」开始 [${chapter.start.toLocaleString()}, ${chapter.end.toLocaleString()})`,
      markEnd: `▲ 第 ${activeIndex + 1} 章结束`,
      info:
        analysis.checks[activeIndex]?.status === "gap"
          ? `⚠ 本章与上一章之间缺失 ${analysis.checks[activeIndex]?.gapChars.toLocaleString()} 字`
          : analysis.checks[activeIndex]?.status === "overlap"
            ? `⚠ 本章与上一章重叠 ${analysis.checks[activeIndex]?.gapChars.toLocaleString()} 字`
            : "切割连续，无缺失",
    };
  }, [rawText, chapters, activeIndex, focusedGap, gaps, analysis]);

  return (
    <aside className="chapter-raw-preview surface" aria-label="原文对照">
      <div className="side-heading">
        <span>原文对照</span>
        {gaps.length > 0 ? (
          <button
            type="button"
            className="text-xs font-normal text-[#b03a32] underline"
            onClick={() => setFocusedGap(null)}
          >
            未切分 {gaps.length} 段
          </button>
        ) : (
          <span className="text-xs font-normal text-muted-foreground">
            全文已切分
          </span>
        )}
      </div>

      {gaps.length > 0 && (
        <div className="chapter-raw-preview__gaps">
          {gaps.map((gap, index) => (
            <button
              key={`${gap.start}-${gap.end}`}
              type="button"
              className={`chapter-raw-preview__gap${focusedGap === index ? " chapter-raw-preview__gap--active" : ""}`}
              onClick={() => setFocusedGap(focusedGap === index ? null : index)}
              title="点击查看该段原文"
            >
              <span className="font-mono">
                [{gap.start.toLocaleString()}, {gap.end.toLocaleString()})
              </span>
              <span>{gap.chars.toLocaleString()} 字</span>
              <span className="truncate">
                {rawText?.slice(gap.start, gap.start + 80) ?? ""}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="chapter-raw-preview__content">
        {focusedGap !== null && gaps[focusedGap] ? (
          <button
            type="button"
            className="chapter-raw-preview__back"
            onClick={() => setFocusedGap(null)}
          >
            ← 返回当前章节
          </button>
        ) : null}
        {content.markStart ? (
          <div className="chapter-raw-preview__mark chapter-raw-preview__mark--start">
            {content.markStart}
          </div>
        ) : null}
        {content.segments.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">{content.info}</p>
        ) : (
          content.segments.map((segment, index) => (
            <div
              key={index}
              className={`chapter-raw-preview__segment chapter-raw-preview__segment--${segment.kind}`}
            >
              {segment.text}
            </div>
          ))
        )}
        {content.markEnd ? (
          <div className="chapter-raw-preview__mark chapter-raw-preview__mark--end">
            {content.markEnd}
          </div>
        ) : null}
        {content.info && content.segments.length > 0 ? (
          <p className="chapter-raw-preview__info">{content.info}</p>
        ) : null}
      </div>
    </aside>
  );
}
