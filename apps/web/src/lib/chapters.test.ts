import { describe, expect, it } from "vitest";
import type { JSONContent } from "@ricetext/editor-core";
import { mergeChapter, splitDocumentByHeadings } from "./chapters";

/** 章节标题：H1 + chapterStart（H1 是唯一的分章层级）。 */
const chapter = (text: string): JSONContent => ({
  type: "heading",
  attrs: { level: 1, chapterStart: true },
  content: [{ type: "text", text }],
});

/** 章内小标题：H2/H3…，不带章节标记。 */
const subheading = (level: number, text: string): JSONContent => ({
  type: "heading",
  attrs: { level, chapterStart: false },
  content: [{ type: "text", text }],
});

const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

describe("splitDocumentByHeadings", () => {
  it("只有 H1 分章：H2 小标题留在所属章节里", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        subheading(2, "书名"),
        chapter("第一章 潮汐表"),
        paragraph("正文一"),
        subheading(2, "小节标题"),
        chapter("第二章 陌生船票"),
        paragraph("正文二"),
      ],
    };
    const { lead, chapters } = splitDocumentByHeadings(doc);
    expect(lead).toEqual([subheading(2, "书名")]);
    expect(chapters.map((item) => item.title)).toEqual(["第一章 潮汐表", "第二章 陌生船票"]);
    expect(chapters[0]!.blocks).toEqual([
      chapter("第一章 潮汐表"),
      paragraph("正文一"),
      subheading(2, "小节标题"),
    ]);
  });

  it("没有章节标记时是一整章，H2 不再各自分章", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        subheading(2, "书名"),
        subheading(2, "第一章 潮汐表"),
        paragraph("正文一"),
        subheading(2, "第二章 陌生船票"),
        paragraph("正文二"),
      ],
    };
    const { lead, chapters } = splitDocumentByHeadings(doc);
    // 整篇只有一章（标题由目录决定），正文里的 H2 都是章内小标题。
    expect(lead).toEqual([]);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe("正文");
    expect(chapters[0]!.end).toBe(5);
  });

  it("历史文档的 H2 章节标题会被升为 H1，目录保持不变", () => {
    const legacy: JSONContent = {
      type: "doc",
      content: [
        subheading(2, "书名"),
        {
          type: "heading",
          attrs: { level: 2, chapterStart: true },
          content: [{ type: "text", text: "第一章" }],
        },
        paragraph("一"),
        {
          type: "heading",
          attrs: { level: 2, chapterStart: true },
          content: [{ type: "text", text: "第二章" }],
        },
        paragraph("二"),
      ],
    };
    const { lead, chapters } = splitDocumentByHeadings(legacy);
    expect(lead).toEqual([subheading(2, "书名")]);
    expect(chapters.map((item) => item.title)).toEqual(["第一章", "第二章"]);
    expect(chapters[0]!.blocks[0]).toEqual(chapter("第一章"));
  });

  it("文档无任何标题时退化为单章", () => {
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
      content: [chapter("第一章"), paragraph("旧正文"), chapter("第二章"), paragraph("保留")],
    };
    const next = mergeChapter(doc, 0, {
      type: "doc",
      content: [chapter("第一章"), paragraph("新正文")],
    });
    expect(next).toEqual({
      type: "doc",
      content: [chapter("第一章"), paragraph("新正文"), chapter("第二章"), paragraph("保留")],
    });
  });
});
