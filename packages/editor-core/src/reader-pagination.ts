import { readerPageState, type ReaderPageState } from "@ricetext/document-core";

export const READER_MOBILE_QUERY = "(max-width: 767px)";
export const READER_COLUMN_GAP = 24;
export function readerColumnCount(scrollWidth: number, width: number, gap = READER_COLUMN_GAP): number {
  if (!Number.isFinite(scrollWidth) || !Number.isFinite(width) || width <= 0) return 1;
  return Math.max(1, Math.ceil((scrollWidth + gap - 1) / (width + gap)));
}
export function resizeReaderPages(previous: ReaderPageState, count: number): ReaderPageState {
  return readerPageState(Math.floor(previous.index / previous.count * count), count);
}
export function readerBodyHeight(viewportHeight: number, chromeHeight: number, lineHeight: number): number {
  const line = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 30;
  const available = Math.min(800, Math.max(400, viewportHeight - 80)) - chromeHeight;
  return Math.max(3, Math.floor(available / line)) * line;
}
