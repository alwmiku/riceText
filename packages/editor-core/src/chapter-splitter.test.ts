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

  it("recognizes compact chapter titles and groups them under volumes", () => {
    const chapters = splitChapters(
      "第一卷 幼儿园卷\n第1章从20年前开始重生?\n正文一\n第2章新生活\n正文二\n第二卷 小学卷\n第3章入学\n正文三",
    );
    expect(chapters).toMatchObject([
      { title: "第1章从20年前开始重生?", volumeTitle: "第一卷 幼儿园卷" },
      { title: "第2章新生活", volumeTitle: "第一卷 幼儿园卷" },
      { title: "第3章入学", volumeTitle: "第二卷 小学卷" },
    ]);
    expect(chapters.map((chapter) => chapter.text)).toEqual([
      "正文一",
      "正文二",
      "正文三",
    ]);
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

  it("keeps numbered lists inside chapters in automatic mode", () => {
    const chapters = splitChapters(
      "第223章 录制宣传视频\n1、宣传视频预计有4分钟\n2、穿着服饰要青春靓丽\n3、采取不露脸宣传的方式\n第224章 我今天就火了？\n正文",
    );
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.text).toContain("1、宣传视频预计有4分钟");
    expect(chapters[0]?.text).toContain("3、采取不露脸宣传的方式");
  });

  it("still recognizes numeric headings when numeric mode is selected", () => {
    const chapters = splitChaptersByStyle(
      "1. 第一节\n正文一\n2、第二节\n正文二",
      "numeric",
    );
    expect(chapters).toMatchObject([
      { title: "1. 第一节", text: "正文一" },
      { title: "2、第二节", text: "正文二" },
    ]);
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
