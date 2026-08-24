import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/** 原文分块参数：每块字符数与估算的行高，用于虚拟滚动。 */
const BLOCK_CHARS = 2000;
const LINE_HEIGHT = 22;
const FONT_SIZE = 13;

interface RawBlock {
  index: number;
  start: number;
  end: number;
  text: string;
}

interface BlockView {
  kind: "chapter" | "chapter-edge" | "gap" | "plain";
  markStart: string | null;
  markEnd: string | null;
  gapLabel: string | null;
}

/**
 * 中间完整原文列：全文按块虚拟滚动显示，当前章节在原文中对齐高亮，
 * 切割起止标记与未切分区间（空洞）以 diff 风格直观展示。
 */
export function ChapterRawPreview({
  rawText,
  chapters,
  activeIndex,
  onCreateFromGap,
}: {
  rawText: string | null;
  chapters: readonly CoverageChapter[];
  activeIndex: number;
  onCreateFromGap?: (text: string, start: number, end: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [focusedGap, setFocusedGap] = useState<number | null>(null);

  const gaps = useMemo(() => collectRawGaps(chapters), [chapters]);
  const analysis = useMemo(() => analyzeCoverage(chapters), [chapters]);

  const blocks = useMemo<RawBlock[]>(() => {
    if (!rawText) return [];
    const list: RawBlock[] = [];
    for (let start = 0; start < rawText.length; start += BLOCK_CHARS) {
      list.push({
        index: list.length,
        start,
        end: Math.min(rawText.length, start + BLOCK_CHARS),
        text: rawText.slice(start, start + BLOCK_CHARS),
      });
    }
    return list;
  }, [rawText]);

  const charsPerLine = Math.max(
    10,
    Math.floor((containerWidth - 24) / FONT_SIZE),
  );

  /** 每块的顶部偏移（估算高度累积）。 */
  const offsets = useMemo(() => {
    const result: number[] = [];
    let total = 0;
    for (const block of blocks) {
      result.push(total);
      const lines = Math.max(1, Math.ceil(block.text.length / charsPerLine));
      total += lines * LINE_HEIGHT + 8;
    }
    return result;
  }, [blocks, charsPerLine]);
  const totalHeight =
    offsets.length > 0 ? (offsets[offsets.length - 1] ?? 0) + 400 : 0;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setContainerWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const handleScroll = () => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setScrollTop(scrollRef.current?.scrollTop ?? 0);
    });
  };
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const scrollToOffset = useCallback((offset: number) => {
    const element = scrollRef.current;
    if (element) element.scrollTop = offset;
    setScrollTop(element?.scrollTop ?? 0);
  }, []);

  const chapter = chapters[activeIndex];
  const chapterStart = chapter?.start ?? null;

  // 点击章节（或首次载入）时滚动到该章在原文中的位置。
  useEffect(() => {
    if (chapterStart === null || offsets.length === 0) return;
    const blockIndex = Math.floor(chapterStart / BLOCK_CHARS);
    scrollToOffset(offsets[Math.min(blockIndex, offsets.length - 1)] ?? 0);
    setFocusedGap(null);
  }, [activeIndex, chapterStart]);

  // 可见块范围：滚动位置 ± 缓冲。
  const viewRange = useMemo(() => {
    if (blocks.length === 0 || offsets.length === 0)
      return { start: 0, end: 0 };
    let low = 0;
    let high = offsets.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((offsets[mid] ?? 0) <= scrollTop) low = mid;
      else high = mid - 1;
    }
    return {
      start: Math.max(0, low - 10),
      end: Math.min(blocks.length, low + 42),
    };
  }, [scrollTop, blocks, offsets]);

  const describeBlock = useCallback(
    (block: RawBlock): BlockView => {
      let kind: BlockView["kind"] = "plain";
      let markStart: string | null = null;
      let markEnd: string | null = null;
      let gapLabel: string | null = null;

      if (chapter && chapter.start !== null && chapter.end !== null) {
        const fullyInside =
          block.start >= chapter.start && block.end <= chapter.end;
        const overlap = block.start < chapter.end && block.end > chapter.start;
        if (fullyInside) {
          kind = "chapter";
        } else if (overlap) {
          kind = "chapter-edge";
          if (block.start <= chapter.start && block.end > chapter.start) {
            markStart = `▼ 第 ${activeIndex + 1} 章「${chapter.title}」开始 [${chapter.start.toLocaleString()}, ${chapter.end.toLocaleString()})`;
          }
          if (block.start < chapter.end && block.end >= chapter.end) {
            markEnd = `▲ 第 ${activeIndex + 1} 章结束`;
          }
        }
      }
      for (const gap of gaps) {
        if (block.start < gap.end && block.end > gap.start) {
          if (kind === "plain") kind = "gap";
          gapLabel = `未切分 [${gap.start.toLocaleString()}, ${gap.end.toLocaleString()}) ${gap.chars.toLocaleString()} 字`;
          break;
        }
      }
      return { kind, markStart, markEnd, gapLabel };
    },
    [chapter, gaps, activeIndex],
  );

  return (
    <aside
      className="sticky top-[116px] flex max-h-[calc(100vh-140px)] flex-col overflow-hidden rounded-lg border border-border bg-white p-2.5 shadow-panel"
      aria-label="原文对照"
    >
      <div className="mb-[11px] flex items-center justify-between gap-2 text-[13px] font-bold">
        <span>原文对照（完整）</span>
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
        <div className="mb-2 flex max-h-[30vh] flex-col gap-1 overflow-auto">
          {gaps.map((gap, index) => (
            <div
              key={`${gap.start}-${gap.end}`}
              className={`flex cursor-pointer items-center gap-1.5 rounded border border-[#f0b4b0] bg-[#fdf1f0] p-0 text-[11px] text-[#8f2b24] hover:bg-[#fbe3e1] ${focusedGap === index ? "bg-[#fbe3e1]" : ""}`}
            >
              <button
                type="button"
                className="grid min-w-0 flex-1 cursor-pointer grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-1.5 border-0 bg-transparent p-1 pl-1.5 text-left text-inherit"
                onClick={() => {
                  setFocusedGap(index);
                  const blockIndex = Math.floor(gap.start / BLOCK_CHARS);
                  scrollToOffset(
                    offsets[Math.min(blockIndex, offsets.length - 1)] ?? 0,
                  );
                }}
                title="滚动到该段原文"
              >
                <span className="font-mono">
                  [{gap.start.toLocaleString()}, {gap.end.toLocaleString()})
                </span>
                <span>{gap.chars.toLocaleString()} 字</span>
                <span className="truncate">
                  {rawText?.slice(gap.start, gap.start + 60) ?? ""}
                </span>
              </button>
              {onCreateFromGap ? (
                <button
                  type="button"
                  className="mr-1 cursor-pointer rounded border-0 bg-[#e2efec] px-1.5 py-[3px] text-[10px] font-semibold whitespace-nowrap text-[#176e66] hover:bg-[#cfe6df]"
                  title="把这 1 段未切分文字创建为新章节"
                  onClick={() =>
                    onCreateFromGap(
                      rawText?.slice(gap.start, gap.end) ?? "",
                      gap.start,
                      gap.end,
                    )
                  }
                >
                  + 建章
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {!rawText ? (
        <p className="p-3 text-xs text-muted-foreground">
          无原文数据，请重新导入文件
        </p>
      ) : (
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto rounded-md border border-[#e3e7ea] bg-[#fbfcfc]"
          onScroll={handleScroll}
        >
          <div style={{ height: totalHeight, position: "relative" }}>
            {blocks.slice(viewRange.start, viewRange.end).map((block) => {
              const view = describeBlock(block);
              const kindClass =
                view.kind === "chapter"
                  ? "bg-[#e9f6f1]"
                  : view.kind === "chapter-edge"
                    ? "bg-[#f0faf6]"
                    : view.kind === "gap"
                      ? "bg-[#fdf1f0]"
                      : "bg-[#fbfcfc]";
              return (
                <div
                  key={block.start}
                  className={`px-2 ${kindClass}`}
                  style={{
                    position: "absolute",
                    top: offsets[block.index],
                    left: 0,
                    right: 0,
                  }}
                >
                  {view.gapLabel ? (
                    <div className="my-[3px] inline-block rounded-[3px] bg-[#fbe3e1] px-1.5 py-px text-[10px] font-semibold text-[#8f2b24]">
                      {view.gapLabel}
                    </div>
                  ) : null}
                  {view.markStart ? (
                    <div className="my-[3px] rounded border-l-[3px] border-[#209065] bg-[#e2efec] px-1.5 py-[3px] text-[11px] font-semibold text-[#176e66]">
                      {view.markStart}
                    </div>
                  ) : null}
                  <div
                    className={`text-[13px] leading-[22px] text-[#1d2a33] whitespace-pre-wrap break-words ${view.kind === "gap" ? "text-[#8f2b24] line-through decoration-[#e5a3a0]" : ""}`}
                  >
                    {block.text}
                  </div>
                  {view.markEnd ? (
                    <div className="my-[3px] rounded border-l-[3px] border-[#9aa4ad] bg-[#eef1f4] px-1.5 py-[3px] text-[11px] font-semibold text-[#5b6670]">
                      {view.markEnd}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {analysis.continuous ? (
        <p className="mt-1.5 px-1.5 py-1 text-[11px] text-[#176e66]">
          切割连续，无缺失
        </p>
      ) : (
        <p className="mt-1.5 px-1.5 py-1 text-[11px] text-[#8f2b24]">
          存在未切分或重叠内容，请检查上方红色标记
        </p>
      )}
    </aside>
  );
}
