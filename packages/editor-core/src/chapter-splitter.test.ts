import { describe, expect, it } from "vitest";

import {
  MAX_CHAPTER_LENGTH,
  splitChapters,
  splitChaptersByStyle,
} from "./chapter-splitter.js";

describe("splitChapters", () => {
  it("splits Chinese chapter headings", () => {
    const text = "第一章 相遇\n正文一\n第二章 离别\n正文二";
    const chapters = splitChapters(text);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toMatchObject({ title: "第一章 相遇", text: "正文一" });
    expect(chapters[1]).toMatchObject({ title: "第二章 离别", text: "正文二" });
  });

  it("returns a single unnamed chapter when no heading is found", () => {
    const chapters = splitChapters("只是一段没有章节标题的文字");
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.title).toBe("未命名章节");
  });

  it("recognizes only the selected heading style", () => {
    const chapters = splitChaptersByStyle(
      "第一章 忽略\n正文\nChapter 1 Keep\nbody",
      "english",
    );
    expect(chapters).toHaveLength(1);
    expect(chapters[0]).toMatchObject({
      title: "Chapter 1 Keep",
      text: "body",
    });
  });

  it("keeps leading extra material as front matter instead of dropping it", () => {
    const chapters = splitChapters(
      "番外：雨季的来信\n番外正文\n第一章 相遇\n正文一",
    );
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toMatchObject({ title: "卷首", start: 0 });
    expect(chapters[0]!.text).toContain("番外：雨季的来信");
    expect(chapters[1]).toMatchObject({ title: "第一章 相遇", text: "正文一" });
    expect(chapters[1]!.start).toBe(chapters[0]!.end);
  });

  it("does not auto-split side-story headings inside the body", () => {
    const chapters = splitChapters(
      "第一章 相遇\n正文一\n番外：相遇之后\n番外正文",
    );
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.text).toContain("番外：相遇之后");
  });

  it("splits chapter headings with leading whitespace", () => {
    const chapters = splitChapters(
      "  第二章 最初之眼\n光芒\n第三章 进化\n正文",
    );
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toMatchObject({
      title: "第二章 最初之眼",
      text: "光芒",
    });
    expect(chapters[1]).toMatchObject({ title: "第三章 进化", text: "正文" });
    expect(chapters[0]!.start).toBe(0);
    expect(chapters[1]!.start).toBe(chapters[0]!.end);
  });

  it("does not treat ad lines as chapter headings", () => {
    const chapters = splitChapters(
      "第一章 最初的细胞\n正文一\n第一章 最初的细胞免费阅读.https://www.biqugexx.com\n第二章 最初之眼\n正文二",
    );
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toMatchObject({ title: "第一章 最初的细胞" });
    expect(chapters[0]!.text).toContain("免费阅读");
    expect(chapters[1]).toMatchObject({
      title: "第二章 最初之眼",
      text: "正文二",
    });
  });

  it("splits oversized chapters locally at the upload boundary", () => {
    const source = `第一章 长章\n${"字".repeat(MAX_CHAPTER_LENGTH + 12)}`;
    const chapters = splitChaptersByStyle(source);
    expect(chapters).toHaveLength(2);
    expect(
      chapters.every((chapter) => chapter.text.length <= MAX_CHAPTER_LENGTH),
    ).toBe(true);
    expect(chapters[0]?.start).toBe(0);
    expect(chapters[0]?.end).toBe(chapters[1]?.start);
    expect(chapters[1]?.title).toBe("第一章 长章（续2）");
  });
});
