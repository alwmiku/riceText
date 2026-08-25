import { prepare, layout, type PreparedText } from "@chenglou/pretext";
import type { CoverageChapter } from "./ChapterCoverageDialog";
import {
  BLOCK_CHARS,
  computeBlockSegments,
  type RawBlock,
  type RawGap,
  type RawSegment,
} from "./raw-coverage";

/** 与面板 CSS 一致的测量字体串（canvas 与 DOM 走同一字体回退链）。 */
export const TEXT_FONT =
  '13px Inter, "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif';
export const TEXT_LINE_HEIGHT = 22;
export const MARKER_FONT =
  '600 11px Inter, "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif';
export const MARKER_LINE_HEIGHT = 16;
export const GAP_LABEL_FONT =
  '600 10px Inter, "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif';
export const GAP_LABEL_LINE_HEIGHT = 14;
/** 行包装 px-2 的水平内边距。 */
export const ROW_PADDING_X = 16;
/** 章标记 px-1.5 + border-l-[3px] 的水平占位。 */
export const MARKER_PADDING_X = 12;
export const MARKER_BORDER_LEFT = 3;
/** 章标记 my-[3px] + py-[3px] 的垂直占位。 */
export const MARKER_VERTICAL = 12;
/** 空洞标签 px-1.5 的水平占位。 */
export const GAP_PADDING_X = 12;
/** 空洞标签 my-[3px] + py-px 的垂直占位。 */
export const GAP_VERTICAL = 8;
/** 文本测量宽度的下限（容器过窄时仍保留可读行宽）。 */
export const MIN_TEXT_WIDTH = 40;

const PREPARE_OPTIONS = { whiteSpace: "pre-wrap" } as const;

/** 单个段落（段文本 + 标记 chrome）在行内的几何布局。 */
export interface RowSegment extends RawSegment {
  top: number;
  bottom: number;
  textHeight: number;
  gapLabelHeight: number;
  markStartHeight: number;
  markEndHeight: number;
}

/** 一行（一个原文分块）的整体布局：高度与段几何。 */
export interface RowLayout {
  index: number;
  blockStart: number;
  blockEnd: number;
  height: number;
  segments: readonly RowSegment[];
}

/** 未测量行的估算行高（首次实测前使用，随后由实测平均接管）。 */
export const FALLBACK_ROW_HEIGHT = Math.max(
  TEXT_LINE_HEIGHT,
  Math.ceil(BLOCK_CHARS / 40) * TEXT_LINE_HEIGHT,
);

/**
 * 惰性行测量器：只有被访问的行（可见行/跳转目标）才执行 pretext 的
 *  prepare + layout；未测量行用平均高度估算（O(1)），
 *  超大文本的打开、滚动与跳转都不会触发全量同步计算。
 */
export interface RowMeasure {
  /** 精确测量并缓存指定行（渲染与跳转目标使用）。 */
  ensureRowLayout(index: number): RowLayout;
  /** 只读高度：已测行返回精确值，未测行返回平均估算。 */
  getRowHeightEstimate(index: number): number;
  /** 行顶部在全文中的像素偏移：已测前缀精确，未测区域按平均估算。 */
  getRowOffset(index: number): number;
  /** 行偏移是否落在连续已测前缀内（精确，无需 DOM 校正）。 */
  isRowOffsetPrecise(index: number): boolean;
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

/**
 * 创建惰性行测量器：每行的 prepare/layout/段切分在首次访问时计算并缓存，
 * 未测行按已测平均高度估算，避免滚动与跳转触发全量同步计算。
 * 该闭包自带全部缓存状态，调用方只负责按需访问。
 */
export function createRowMeasure(
  blocks: readonly RawBlock[],
  chapter: CoverageChapter | undefined,
  gaps: readonly RawGap[],
  activeIndex: number,
  contentWidth: number,
): RowMeasure {
  const preparedCache = new Map<number, PreparedText>();
  const segmentCache = new Map<number, RawSegment[]>();
  const layoutCache = new Map<number, RowLayout>();
  /** offsets[i] = 行 i 顶部偏移，仅对连续已测前缀有效。 */
  const offsets: number[] = [0];
  /** 连续已测前缀长度（行 0..preciseUpTo-1 已精确测量）。 */
  let preciseUpTo = 0;
  let heightSum = 0;
  let measuredCount = 0;

  const averageHeight = () =>
    measuredCount > 0 ? heightSum / measuredCount : FALLBACK_ROW_HEIGHT;

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

  const computeRowLayout = (index: number): RowLayout => {
    const block = blocks[index];
    if (!block) {
      return {
        index,
        blockStart: 0,
        blockEnd: 0,
        height: 0,
        segments: [],
      };
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
    return {
      index,
      blockStart: block.start,
      blockEnd: block.end,
      height:
        rowSegments.length === 0
          ? 0
          : rowSegments[rowSegments.length - 1]!.bottom,
      segments: rowSegments,
    };
  };

  const ensureRowLayout = (index: number): RowLayout => {
    let layout = layoutCache.get(index);
    if (layout) return layout;
    layout = computeRowLayout(index);
    layoutCache.set(index, layout);
    // 只有连续前缀扩展（滚动顺序测量）更新估算平均：跳转目标的孤立
    // 测量属于含章节/空洞标记的特殊行，不应污染常规行的平均高度。
    while (preciseUpTo < blocks.length && layoutCache.has(preciseUpTo)) {
      const height = layoutCache.get(preciseUpTo)!.height;
      offsets[preciseUpTo + 1] = (offsets[preciseUpTo] ?? 0) + height;
      preciseUpTo += 1;
      heightSum += height;
      measuredCount += 1;
    }
    return layout;
  };

  const getRowHeightEstimate = (index: number): number => {
    const layout = layoutCache.get(index);
    return layout ? layout.height : averageHeight();
  };

  const getRowOffset = (index: number): number => {
    if (index < preciseUpTo) return offsets[index] ?? 0;
    const precise = offsets[preciseUpTo] ?? 0;
    return precise + (index - preciseUpTo) * averageHeight();
  };

  const isRowOffsetPrecise = (index: number): boolean => index < preciseUpTo;

  return {
    ensureRowLayout,
    getRowHeightEstimate,
    getRowOffset,
    isRowOffsetPrecise,
  };
}
