import { useCallback, useRef, type RefObject } from "react";
import type { ListImperativeAPI } from "react-window";
import { BLOCK_CHARS, type RawBlock } from "./raw-coverage";
import type { RowMeasure } from "./raw-row-measure";

/**
 * 原文导航：章首/章尾/空洞跳转与估算偏移的 DOM 校正。
 * 依赖惰性测量器（measure）与 react-window 的 listRef：
 * - 已测前缀内的目标偏移是精确的，直接落位；
 * - 未测区域按平均高度估算落位，再读取目标行实际位置做一次迭代校正。
 */
export function useRawPreviewNavigation({
  blocks,
  measure,
  containerHeight,
}: {
  blocks: readonly RawBlock[];
  measure: RowMeasure;
  containerHeight: number;
}): {
  listRef: RefObject<ListImperativeAPI | null>;
  rowIndexOf(rawIndex: number): number;
  scrollToStartAnchor(rawIndex: number): void;
  scrollToEndAnchor(chapterEnd: number): void;
  scrollToGap(gapStart: number): void;
} {
  const listRef = useRef<ListImperativeAPI>(null);

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

  const scrollToPixel = useCallback((offset: number) => {
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
  }, []);

  // 估算前缀的落位校正：跳转后读取目标行在视口内的实际位置，
  // 把偏差修正回期望位置（估算平均误差无累积，一次迭代即可）。
  const correctScroll = useCallback(
    (rowIndex: number, expectedRowTopInViewport: number) => {
      requestAnimationFrame(() => {
        const element = listRef.current?.element;
        const rowElement = element?.querySelector<HTMLElement>(
          `[data-react-window-index="${rowIndex}"]`,
        );
        if (!element || !rowElement) return;
        const containerRect = element.getBoundingClientRect();
        // jsdom/无布局环境下 rect 全 0，无法测量时跳过校正。
        if (containerRect.width === 0 && containerRect.height === 0) return;
        const rowTop =
          rowElement.getBoundingClientRect().top - containerRect.top;
        const delta = expectedRowTopInViewport - rowTop;
        if (Math.abs(delta) > 1) element.scrollTop += delta;
      });
    },
    [],
  );

  const scrollToStartAnchor = useCallback(
    (rawIndex: number) => {
      const rowIndex = rowIndexOf(rawIndex);
      const row = measure.ensureRowLayout(rowIndex);
      const segment = row.segments.find((item) => item.start === rawIndex);
      if (!segment) return;
      const inRowTop = segment.top + segment.gapLabelHeight;
      scrollToPixel(measure.getRowOffset(rowIndex) + inRowTop - 8);
      // 仅估算偏移需要 DOM 校正；精确偏移（如文档顶部的章首）不得画蛇添足。
      if (!measure.isRowOffsetPrecise(rowIndex))
        correctScroll(rowIndex, 8 - inRowTop);
    },
    [measure, rowIndexOf, scrollToPixel, correctScroll],
  );

  const scrollToEndAnchor = useCallback(
    (chapterEnd: number) => {
      const rowIndex = rowIndexOf(Math.max(0, chapterEnd - 1));
      const row = measure.ensureRowLayout(rowIndex);
      const segment = row.segments.find((item) => item.end === chapterEnd);
      if (!segment) return;
      const inRowTop =
        segment.top +
        segment.gapLabelHeight +
        segment.markStartHeight +
        segment.textHeight;
      const viewportTop = Math.max(
        8,
        containerHeight - segment.markEndHeight - 56,
      );
      scrollToPixel(measure.getRowOffset(rowIndex) + inRowTop - viewportTop);
      if (!measure.isRowOffsetPrecise(rowIndex))
        correctScroll(rowIndex, viewportTop - inRowTop);
    },
    [measure, rowIndexOf, containerHeight, scrollToPixel, correctScroll],
  );

  const scrollToGap = useCallback(
    (gapStart: number) => {
      const rowIndex = rowIndexOf(gapStart);
      const row = measure.ensureRowLayout(rowIndex);
      const segment = row.segments.find((item) => item.start === gapStart);
      if (!segment) return;
      scrollToPixel(measure.getRowOffset(rowIndex) + segment.top - 8);
      if (!measure.isRowOffsetPrecise(rowIndex))
        correctScroll(rowIndex, 8 - segment.top);
    },
    [measure, rowIndexOf, scrollToPixel, correctScroll],
  );

  return {
    listRef,
    rowIndexOf,
    scrollToStartAnchor,
    scrollToEndAnchor,
    scrollToGap,
  };
}
