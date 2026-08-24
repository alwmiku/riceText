import { MAX_CHAPTER_LENGTH } from "@ricetext/editor-core";
import { prepare, layout, type PreparedText } from "@chenglou/pretext";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  List,
  getScrollbarSize,
  type ListImperativeAPI,
  type RowComponentProps,
} from "react-window";
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

/** 原文分块参数：每块字符数。行高/行数由 @chenglou/pretext 精确测量，不再手工估算。 */
const BLOCK_CHARS = 2000;
/** 与面板 CSS 一致的测量字体串（canvas 与 DOM 走同一字体回退链）。 */
const TEXT_FONT =
  '13px Inter, "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif';
const TEXT_LINE_HEIGHT = 22;
const MARKER_FONT =
  '600 11px Inter, "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif';
const MARKER_LINE_HEIGHT = 16;
const GAP_LABEL_FONT =
  '600 10px Inter, "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif';
const GAP_LABEL_LINE_HEIGHT = 14;
/** 行包装 px-2 的水平内边距。 */
const ROW_PADDING_X = 16;
/** 章标记 px-1.5 + border-l-[3px] 的水平占位。 */
const MARKER_PADDING_X = 12;
const MARKER_BORDER_LEFT = 3;
/** 章标记 my-[3px] + py-[3px] 的垂直占位。 */
const MARKER_VERTICAL = 12;
/** 空洞标签 px-1.5 的水平占位。 */
const GAP_PADDING_X = 12;
/** 空洞标签 my-[3px] + py-px 的垂直占位。 */
const GAP_VERTICAL = 8;
const FALLBACK_CONTAINER_WIDTH = 520;
const FALLBACK_CONTAINER_HEIGHT = 360;
const MIN_TEXT_WIDTH = 40;

const PREPARE_OPTIONS = { whiteSpace: "pre-wrap" } as const;

interface RawBlock {
  index: number;
  start: number;
  end: number;
  text: string;
}

interface RawSegment {
  start: number;
  end: number;
  text: string;
  kind: "chapter" | "gap" | "plain";
  markStart: string | null;
  markEnd: string | null;
  gapLabel: string | null;
}

/** 单个段落（段文本 + 标记 chrome）在行内的几何布局。 */
interface RowSegment extends RawSegment {
  top: number;
  bottom: number;
  textHeight: number;
  gapLabelHeight: number;
  markStartHeight: number;
  markEndHeight: number;
}

/** 一行（一个原文分块）的整体布局：高度与段几何。 */
interface RowLayout {
  index: number;
  blockStart: number;
  blockEnd: number;
  height: number;
  segments: readonly RowSegment[];
}

/** 惰性行测量器：只计算被访问的行（可见行/跳转目标），
 *  避免超大文本进入界面时一次性全量 prepare + layout 阻塞主线程。 */
interface RowMeasure {
  getRowLayout(index: number): RowLayout;
  /** 行顶部在全文中的像素偏移（前缀和，按需计算并缓存）。 */
  getRowOffset(index: number): number;
}

interface RawRowProps {
  measure: RowMeasure;
}

/** 测量文本高度：至少占一行，避免空行塌缩。 */
function measureHeight(
  prepared: PreparedText,
  width: number,
  lineHeight: number,
): number {
  return Math.max(lineHeight, layout(prepared, width, lineHeight).height);
}

/** 测量标记块高度：垂直占位 + pretext 测量的文本行高。 */
function measureMarkup(
  text: string,
  font: string,
  lineHeight: number,
  width: number,
  verticalChrome: number,
): number {
  return (
    verticalChrome +
    measureHeight(prepare(text, font), width, lineHeight)
  );
}

/** 把原文块切为带章节/空洞标记的段（纯文本切分，不含测量）。 */
function computeBlockSegments(
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

/** 创建惰性行测量器：每行的 prepare/layout/段切分都在首次访问时计算并缓存。 */
function createRowMeasure(
  blocks: readonly RawBlock[],
  chapter: CoverageChapter | undefined,
  gaps: readonly RawGap[],
  activeIndex: number,
  contentWidth: number,
): RowMeasure {
  const preparedCache = new Map<number, PreparedText>();
  const segmentCache = new Map<number, RawSegment[]>();
  const layoutCache = new Map<number, RowLayout>();
  const offsets: number[] = [];

  const getPrepared = (index: number): PreparedText => {
    let prepared = preparedCache.get(index);
    if (!prepared) {
      prepared = prepare(
        blocks[index]?.text ?? "",
        TEXT_FONT,
        PREPARE_OPTIONS,
      );
      preparedCache.set(index, prepared);
    }
    return prepared;
  };

  const getSegments = (index: number): RawSegment[] => {
    let segments = segmentCache.get(index);
    if (!segments) {
      const block = blocks[index];
      segments = block
        ? computeBlockSegments(block, chapter, gaps, activeIndex)
        : [];
      segmentCache.set(index, segments);
    }
    return segments;
  };

  const getRowLayout = (index: number): RowLayout => {
    let layout = layoutCache.get(index);
    if (layout) return layout;
    const block = blocks[index];
    if (!block) {
      layout = {
        index,
        blockStart: 0,
        blockEnd: 0,
        height: 0,
        segments: [],
      };
      layoutCache.set(index, layout);
      return layout;
    }
    const segments = getSegments(index);
    const rowSegments: RowSegment[] = [];
    let top = 0;
    for (const segment of segments) {
      const textHeight =
        segment.text === block.text
          ? measureHeight(getPrepared(index), contentWidth, TEXT_LINE_HEIGHT)
          : measureHeight(
              prepare(segment.text, TEXT_FONT, PREPARE_OPTIONS),
              contentWidth,
              TEXT_LINE_HEIGHT,
            );
      const gapLabelHeight =
        segment.gapLabel === null
          ? 0
          : measureMarkup(
              segment.gapLabel,
              GAP_LABEL_FONT,
              GAP_LABEL_LINE_HEIGHT,
              contentWidth - GAP_PADDING_X,
              GAP_VERTICAL,
            );
      const markStartHeight =
        segment.markStart === null
          ? 0
          : measureMarkup(
              segment.markStart,
              MARKER_FONT,
              MARKER_LINE_HEIGHT,
              contentWidth - MARKER_PADDING_X - MARKER_BORDER_LEFT,
              MARKER_VERTICAL,
            );
      const markEndHeight =
        segment.markEnd === null
          ? 0
          : measureMarkup(
              segment.markEnd,
              MARKER_FONT,
              MARKER_LINE_HEIGHT,
              contentWidth - MARKER_PADDING_X - MARKER_BORDER_LEFT,
              MARKER_VERTICAL,
            );
      rowSegments.push({
        ...segment,
        top,
        textHeight,
        gapLabelHeight,
        markStartHeight,
        markEndHeight,
        bottom:
          top +
          gapLabelHeight +
          markStartHeight +
          textHeight +
          markEndHeight,
      });
      top = rowSegments[rowSegments.length - 1]!.bottom;
    }
    layout = {
      index,
      blockStart: block.start,
      blockEnd: block.end,
      height:
        rowSegments.length === 0
          ? 0
          : rowSegments[rowSegments.length - 1]!.bottom,
      segments: rowSegments,
    };
    layoutCache.set(index, layout);
    return layout;
  };

  const getRowOffset = (index: number): number => {
    for (let i = offsets.length; i <= index; i += 1) {
      offsets[i] =
        (i === 0 ? 0 : (offsets[i - 1] ?? 0)) + getRowLayout(i - 1).height;
    }
    return offsets[index] ?? 0;
  };

  return { getRowLayout, getRowOffset };
}

/** 单行渲染：章高亮、空洞删除线、章首/章尾标记与空洞标签。 */
function RawRow({
  index,
  style,
  ariaAttributes,
  measure,
}: RowComponentProps<RawRowProps>) {
  const layout = measure.getRowLayout(index);
  if (layout.height === 0 && layout.segments.length === 0) return null;
  return (
    <div style={style} {...ariaAttributes} className="px-2">
      {layout.segments.map((segment) => {
        const kindClass =
          segment.kind === "chapter"
            ? "bg-[#e9f6f1]"
            : segment.kind === "gap"
              ? "bg-[#fdf1f0] text-[#8f2b24] line-through decoration-[#e5a3a0]"
              : "bg-[#fbfcfc]";
        return (
          <div key={`${segment.start}-${segment.end}`}>
            {segment.gapLabel ? (
              <div className="my-[3px] inline-block rounded-[3px] bg-[#fbe3e1] px-1.5 py-px text-[10px] leading-[14px] font-semibold text-[#8f2b24]">
                {segment.gapLabel}
              </div>
            ) : null}
            {segment.markStart ? (
              <div
                className="my-[3px] rounded border-l-[3px] border-[#209065] bg-[#e2efec] px-1.5 py-[3px] text-[11px] leading-[16px] font-semibold text-[#176e66]"
                data-raw-anchor={`start-${segment.start}`}
              >
                {segment.markStart}
              </div>
            ) : null}
            <div
              className={`text-[13px] leading-[22px] whitespace-pre-wrap break-words text-[#1d2a33] ${kindClass}`}
            >
              {segment.text}
            </div>
            {segment.markEnd ? (
              <div
                className="my-[3px] rounded border-l-[3px] border-[#9aa4ad] bg-[#eef1f4] px-1.5 py-[3px] text-[11px] leading-[16px] font-semibold text-[#5b6670]"
                data-raw-anchor={`end-${segment.end}`}
              >
                {segment.markEnd}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 中间完整原文列：@chenglou/pretext 精确测量每块行高，
 * react-window List 负责虚拟滚动；当前章节在原文中对齐高亮，
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
  const listRef = useRef<ListImperativeAPI>(null);
  const [containerWidth, setContainerWidth] = useState(
    FALLBACK_CONTAINER_WIDTH,
  );
  const [containerHeight, setContainerHeight] = useState(
    FALLBACK_CONTAINER_HEIGHT,
  );
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 0 });
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

  const contentWidth = Math.max(
    MIN_TEXT_WIDTH,
    containerWidth - ROW_PADDING_X - getScrollbarSize(),
  );

  const chapter = chapters[activeIndex];
  const chapterStart = chapter?.start ?? null;

  // 惰性测量器：只有被访问的行（可见行/跳转目标）才执行 pretext 的
  // prepare + layout，超大文本首次进入界面不会一次性全量计算。
  const measure = useMemo(
    () => createRowMeasure(blocks, chapter, gaps, activeIndex, contentWidth),
    [blocks, chapter, gaps, activeIndex, contentWidth],
  );

  const rowIndexOf = useCallback(
    (rawIndex: number) =>
      blocks.length === 0
        ? 0
        : Math.min(
            blocks.length - 1,
            Math.max(0, Math.floor(rawIndex / BLOCK_CHARS)),
          ),
    [blocks.length],
  );

  const scrollToPixel = useCallback(
    (offset: number) => {
      const element = listRef.current?.element;
      if (!element) return;
      const target = Math.max(0, offset);
      const maxScroll = element.scrollHeight - element.clientHeight;
      // spacer 按已知行均值外推时可能暂时小于目标；先顶到当前最大，
      // 下一帧 react-window 补全 bounds 后再落位。
      if (element.scrollHeight > 0 && target > maxScroll) {
        element.scrollTop = Math.max(0, maxScroll);
        requestAnimationFrame(() => {
          const next = listRef.current?.element;
          if (next) next.scrollTop = target;
        });
        return;
      }
      element.scrollTop = target;
    },
    [listRef],
  );

  const scrollToStartAnchor = useCallback(
    (rawIndex: number) => {
      const rowIndex = rowIndexOf(rawIndex);
      const row = measure.getRowLayout(rowIndex);
      const segment = row.segments.find((item) => item.start === rawIndex);
      if (!segment) return;
      scrollToPixel(
        measure.getRowOffset(rowIndex) +
          segment.top +
          segment.gapLabelHeight -
          8,
      );
    },
    [measure, rowIndexOf, scrollToPixel],
  );

  const scrollToEndAnchor = useCallback(
    (chapterEnd: number) => {
      const rowIndex = rowIndexOf(Math.max(0, chapterEnd - 1));
      const row = measure.getRowLayout(rowIndex);
      const segment = row.segments.find((item) => item.end === chapterEnd);
      if (!segment) return;
      const anchorTop =
        segment.top +
        segment.gapLabelHeight +
        segment.markStartHeight +
        segment.textHeight;
      const viewportTop = Math.max(
        8,
        containerHeight - segment.markEndHeight - 56,
      );
      scrollToPixel(
        measure.getRowOffset(rowIndex) + anchorTop - viewportTop,
      );
    },
    [measure, rowIndexOf, containerHeight, scrollToPixel],
  );

  const scrollToGap = useCallback(
    (gapStart: number) => {
      const rowIndex = rowIndexOf(gapStart);
      const row = measure.getRowLayout(rowIndex);
      const segment = row.segments.find((item) => item.start === gapStart);
      if (!segment) return;
      scrollToPixel(measure.getRowOffset(rowIndex) + segment.top - 8);
    },
    [measure, rowIndexOf, scrollToPixel],
  );

  // 点击章节（或首次载入）时滚动到该章在原文中的位置。
  useEffect(() => {
    if (chapterStart === null) return;
    scrollToStartAnchor(chapterStart);
    setFocusedGap(null);
  }, [activeIndex, chapterStart, scrollToStartAnchor]);

  const handleResize = useCallback(
    (size: { height: number; width: number }) => {
      if (size.width > 0) setContainerWidth(size.width);
      if (size.height > 0) setContainerHeight(size.height);
    },
    [],
  );

  const handleRowsRendered = useCallback(
    (visible: { startIndex: number; stopIndex: number }) => {
      const start = blocks[visible.startIndex]?.start ?? 0;
      const end = blocks[visible.stopIndex]?.end ?? 0;
      setVisibleRange({ start, end });
    },
    [blocks],
  );

  const rowHeight = useCallback(
    (index: number) => measure.getRowLayout(index).height,
    [measure],
  );

  const chapterRangeStart = chapter?.start ?? null;
  const chapterRangeEnd = chapter?.end ?? null;
  const hasChapterRange =
    chapterRangeStart !== null && chapterRangeEnd !== null;
  const chapterRangeText = hasChapterRange
    ? `[${chapterRangeStart.toLocaleString()}, ${chapterRangeEnd.toLocaleString()})`
    : "无原文区间";

  return (
    <aside
      className="sticky top-[116px] flex max-h-[calc(100vh-140px)] flex-col overflow-hidden rounded-lg border border-border bg-white p-2.5 shadow-panel"
      aria-label="原文对照"
    >
      <div className="mb-2 flex flex-col gap-1.5 text-[13px]">
        <div className="flex items-start justify-between gap-2 font-bold">
          <span>原文对照（虚拟滚动）</span>
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
        <div className="grid gap-1 rounded-md bg-[#f5f8f8] px-2 py-1.5 text-[11px] font-normal text-muted-foreground">
          <div>
            已加载原文 {rawText ? rawText.length.toLocaleString() : "0"} 字 · 共{" "}
            {blocks.length.toLocaleString()} 块 · 当前显示 [
            {visibleRange.start.toLocaleString()}, {visibleRange.end.toLocaleString()})
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span>
              当前章{" "}
              {chapter
                ? `${(activeIndex + 1).toLocaleString()} · ${chapter.charCount.toLocaleString()} 字`
                : "未选择"}{" "}
              · {chapterRangeText}
            </span>
            <button
              type="button"
              className="rounded border border-[#cfd9d6] bg-white px-1.5 py-[1px] text-[10px] text-[#176e66] disabled:cursor-not-allowed disabled:text-muted-foreground"
              disabled={!hasChapterRange}
              onClick={() => {
                if (chapterRangeStart !== null)
                  scrollToStartAnchor(chapterRangeStart);
              }}
            >
              章首
            </button>
            <button
              type="button"
              className="rounded border border-[#cfd9d6] bg-white px-1.5 py-[1px] text-[10px] text-[#176e66] disabled:cursor-not-allowed disabled:text-muted-foreground"
              disabled={!hasChapterRange}
              onClick={() => {
                if (chapterRangeEnd !== null) scrollToEndAnchor(chapterRangeEnd);
              }}
            >
              章尾
            </button>
          </div>
          <div>
            单章上限 {MAX_CHAPTER_LENGTH.toLocaleString()}{" "}
            字，超长导入会拆为续章
          </div>
        </div>
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
                  scrollToGap(gap.start);
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
        <List
          listRef={listRef}
          className="min-h-0 flex-1 rounded-md border border-[#e3e7ea] bg-[#fbfcfc]"
          aria-label="完整原文滚动区"
          rowCount={blocks.length}
          rowHeight={rowHeight}
          rowComponent={RawRow}
          rowProps={{ measure }}
          defaultHeight={FALLBACK_CONTAINER_HEIGHT}
          overscanCount={6}
          onResize={handleResize}
          onRowsRendered={handleRowsRendered}
        />
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
