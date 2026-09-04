import { MAX_CHAPTER_LENGTH } from "@ricetext/editor-core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { List, getScrollbarSize } from "react-window";
import { analyzeCoverage, type CoverageChapter } from "./ChapterCoverageDialog";
import {
  BLOCK_CHARS,
  collectRawGaps,
  type RawBlock,
} from "./raw-coverage";
import {
  createRowMeasure,
  FALLBACK_ROW_HEIGHT,
  MIN_TEXT_WIDTH,
  ROW_PADDING_X,
} from "./raw-row-measure";
import { RawPreviewRow } from "./RawPreviewRow";
import { useRawPreviewNavigation } from "./useRawPreviewNavigation";

const FALLBACK_CONTAINER_WIDTH = 520;
const FALLBACK_CONTAINER_HEIGHT = 360;

/**
 * 中间完整原文列：@chenglou/pretext 精确测量每块行高（raw-row-measure），
 * react-window List 负责虚拟滚动；当前章节在原文中对齐高亮，
 * 切割起止标记与未切分区间（空洞）以 diff 风格直观展示。
 * 本组件只组合状态、惰性测量器与顶部信息面板。
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
  onCreateFromGap?: (
    text: string,
    start: number,
    end: number,
  ) => void | Promise<void>;
}) {
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

  // 预测量初始可见行：让 react-window 首次 bounds 计算即为精确值，
  // 避免 fallback 估算高度导致首屏行位置错乱。只测一个视口的行，开销可忽略。
  const initialRowCount = useMemo(() => {
    const estimated = Math.ceil(containerHeight / FALLBACK_ROW_HEIGHT) + 8;
    return Math.min(blocks.length, estimated);
  }, [blocks.length, containerHeight]);
  for (let index = 0; index < initialRowCount; index += 1) {
    measure.ensureRowLayout(index);
  }

  const { listRef, scrollToStartAnchor, scrollToEndAnchor, scrollToGap } =
    useRawPreviewNavigation({ blocks, measure, containerHeight });

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

  // 高度估算：已测行精确、未测行按平均估算——react-window 的 bounds
  // 计算与滚动条拖动因此是 O(1)/行的，不会被 pretext 全量测量卡住。
  const rowHeight = useCallback(
    (index: number) => measure.getRowHeightEstimate(index),
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
                    void onCreateFromGap(
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
          rowComponent={RawPreviewRow}
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
