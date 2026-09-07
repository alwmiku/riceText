import { describe, expect, it } from "vitest";
import { currentReaderTime, readerBookTitle, readerPageState } from "@ricetext/document-core";
import { readerBodyHeight, readerColumnCount, resizeReaderPages } from "./reader-pagination.js";

describe("reader pagination state", () => {
  it("clamps every page navigation to real boundaries", () => {
    expect(readerPageState(-1, 4)).toEqual({ index: 0, count: 4 });
    expect(readerPageState(9, 4)).toEqual({ index: 3, count: 4 });
    expect(readerPageState(2, 0)).toEqual({ index: 0, count: 1 });
    expect(readerPageState(NaN, Infinity)).toEqual({ index: 0, count: 1 });
  });
  it("counts browser columns including their gaps and subpixel rounding", () => {
    expect(readerColumnCount(280, 280)).toBe(1);
    expect(readerColumnCount(584, 280)).toBe(2);
    expect(readerColumnCount(584.5, 280)).toBe(2);
    expect(readerColumnCount(888, 280)).toBe(3);
    expect(readerColumnCount(500, 0)).toBe(1);
    expect(readerColumnCount(2312, 309.75)).toBe(7);
  });
  it("keeps approximate reading position when layout changes", () => {
    expect(resizeReaderPages({ index: 3, count: 6 }, 10)).toEqual({ index: 5, count: 10 });
    expect(resizeReaderPages({ index: 0, count: 1 }, 4)).toEqual({ index: 0, count: 4 });
  });
  it("allocates complete lines and minimum reading space", () => {
    expect(readerBodyHeight(844, 170, 36)).toBe(576);
    expect(readerBodyHeight(300, 500, 36)).toBe(108);
  });
  it("formats local creation time and titles without duplicate brackets", () => {
    expect(currentReaderTime(new Date(2026, 8, 7, 6, 5))).toBe("06:05");
    expect(readerBookTitle(" 小说 ")).toBe("《小说》");
    expect(readerBookTitle("《小说》")).toBe("《小说》");
    expect(readerBookTitle("")).toBe("");
  });
});
