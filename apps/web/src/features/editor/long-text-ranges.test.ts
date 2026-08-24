import { describe, expect, it } from "vitest";

import {
  expandRawRangeToIncludeLeadingTitle,
  rawRangeForGapChapter,
  splitRawRangeAtCursor,
} from "./long-text-ranges";

describe("long-text raw ranges", () => {
  it("preserves raw ranges when splitting a ranged chapter at the cursor", () => {
    const ranges = splitRawRangeAtCursor(
      {
        start: 100,
        end: 220,
        text: "正文".repeat(50),
      },
      "正文".repeat(20),
      "正文".repeat(30),
    );

    expect(ranges).toEqual({
      before: { start: 100, end: 160 },
      after: { start: 160, end: 220 },
    });
  });

  it("returns null ranges when the original chapter has no raw range", () => {
    expect(
      splitRawRangeAtCursor(
        { start: null, end: null, text: "正文" },
        "正",
        "文",
      ),
    ).toEqual({
      before: { start: null, end: null },
      after: { start: null, end: null },
    });
  });

  it("keeps the raw range for a chapter created from an uncut gap", () => {
    expect(rawRangeForGapChapter(200, 280, "字".repeat(80))).toEqual({
      start: 200,
      end: 280,
    });
  });

  it("caps a gap-created chapter range to the stored chapter text length", () => {
    expect(rawRangeForGapChapter(200, 80_000, "字".repeat(80_000))).toEqual({
      start: 200,
      end: 50_200,
    });
  });
  it("expands a legacy range backward when the gap only contains its title", () => {
    const rawText = "上一章正文\n第一章 最初的细胞\n本章正文";
    expect(
      expandRawRangeToIncludeLeadingTitle(
        rawText,
        "第一章 最初的细胞",
        rawText.indexOf("本章正文"),
        "上一章正文\n".length,
      ),
    ).toBe("上一章正文\n".length);
  });

  it("does not expand a legacy range through unrelated gap text", () => {
    const rawText = "上一章正文\n广告\n第一章 最初的细胞\n本章正文";
    expect(
      expandRawRangeToIncludeLeadingTitle(
        rawText,
        "第一章 最初的细胞",
        rawText.indexOf("本章正文"),
        "上一章正文\n".length,
      ),
    ).toBe(rawText.indexOf("本章正文"));
  });
});
