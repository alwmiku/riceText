import { describe, expect, it } from "vitest";
import type { JSONContent } from "@ricetext/editor-core";
import { mergeChapter, splitDocumentByHeadings } from "./chapters";

const heading = (
  level: number,
  text: string,
  chapterStart = false,
): JSONContent => ({
  type: "heading",
  attrs: chapterStart ? { level, chapterStart: true } : { level },
  content: [{ type: "text", text }],
});

const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

describe("splitDocumentByHeadings", () => {
  it("没有章节标记时按二级标题兜底切分（历史文档兼容）", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        heading(1, "书名"),
        heading(2, "第一章 潮汐表"),
        paragraph("正文一"),
        heading(2, "第二章 陌生船票"),
        paragraph("正文二"),
      ],
    };
    const { lead, chapters } = splitDocumentByHeadings(doc);
    expect(lead).toEqual([heading(1, "书名")]);
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "第一章 潮汐表",
      "第二章 陌生船票",
    ]);
    expect(chapters[0]!.blocks.length).toBe(2);
  });

  it("章节标记存在时，正文内的普通一级/二级标题不再切分章节", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        heading(2, "第一章 潮汐表", true),
        paragraph("正文一"),
        heading(2, "小节标题"),
        heading(1, "正文里的大标题"),
        paragraph("正文二"),
        heading(2, "第二章 陌生船票", true),
        paragraph("正文三"),
      ],
    };
    const { chapters } = splitDocumentByHeadings(doc);
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "第一章 潮汐表",
      "第二章 陌生船票",
    ]);
    // 第一章包含两个普通标题与两段正文，未被切成多个章节。
    expect(chapters[0]!.blocks).toEqual([
      heading(2, "第一章 潮汐表", true),
      paragraph("正文一"),
      heading(2, "小节标题"),
      heading(1, "正文里的大标题"),
      paragraph("正文二"),
    ]);
  });

  it("标记章节可以是一级标题，且文档无任何标题时退化为单章", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        heading(1, "第一章 潮汐表", true),
        paragraph("正文"),
      ],
    };
    expect(
      splitDocumentByHeadings(doc).chapters.map((chapter) => chapter.title),
    ).toEqual(["第一章 潮汐表"]);

    const noHeading: JSONContent = {
      type: "doc",
      content: [paragraph("只有正文")],
    };
    const single = splitDocumentByHeadings(noHeading);
    expect(single.chapters).toHaveLength(1);
    expect(single.chapters[0]!.title).toBe("正文");
  });

  it("mergeChapter 只替换对应章节的区间", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        heading(2, "第一章", true),
        paragraph("旧正文"),
        heading(2, "第二章", true),
        paragraph("保留"),
      ],
    };
    const next = mergeChapter(doc, 0, {
      type: "doc",
      content: [heading(2, "第一章", true), paragraph("新正文")],
    });
    expect(next).toEqual({
      type: "doc",
      content: [
        heading(2, "第一章", true),
        paragraph("新正文"),
        heading(2, "第二章", true),
        paragraph("保留"),
      ],
    });
  });
});
