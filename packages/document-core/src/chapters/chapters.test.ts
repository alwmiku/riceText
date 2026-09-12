import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import {
  appendChapter,
  getChapterRange,
  normalizeChapterHeadings,
  removeChapter,
  replaceChapter,
  splitDocumentByChapters,
} from "./index.js";

const heading = (level: number, text: string, chapterStart = false): JSONContent => ({
  type: "heading",
  attrs: chapterStart ? { level, chapterStart: true } : { level },
  content: [{ type: "text", text }],
});
/** 新模型的章节标题：H1 + chapterStart。 */
const chapter = (text: string): JSONContent => heading(1, text, true);
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

describe("chapter document operations", () => {
  it("只有 H1 分章，H2/H3 只是章内小标题", () => {
    const document: JSONContent = {
      type: "doc",
      content: [
        chapter("第一章"),
        paragraph("一"),
        heading(2, "小节"),
        heading(3, "更小的节"),
        chapter("第二章"),
        paragraph("二"),
      ],
    };
    const result = splitDocumentByChapters(document);
    expect(result.lead).toEqual([]);
    expect(result.chapters.map((item) => item.title)).toEqual(["第一章", "第二章"]);
    expect(result.chapters[0]!.blocks).toEqual([
      chapter("第一章"),
      paragraph("一"),
      // H2/H3 小标题原样保留（不含 chapterStart 的写法会补成显式 false）。
      { ...heading(2, "小节"), attrs: { level: 2, chapterStart: false } },
      { ...heading(3, "更小的节"), attrs: { level: 3, chapterStart: false } },
    ]);
    expect(getChapterRange(document, 1)).toEqual({ start: 4, end: 6 });
  });

  it("把历史文档的 H2 章节标题升为 H1，目录不会被清空", () => {
    const legacy: JSONContent = {
      type: "doc",
      content: [
        heading(1, "书名"),
        heading(2, "第一章", true),
        paragraph("一"),
        heading(2, "第二章", true),
        paragraph("二"),
      ],
    };
    const result = splitDocumentByChapters(legacy);
    // 章节标题升为 H1（保留 chapterStart），书名下移为 H2 小标题留在 lead 里。
    expect(result.lead).toEqual([
      { ...heading(2, "书名"), attrs: { level: 2, chapterStart: false } },
    ]);
    expect(result.chapters.map((item) => item.title)).toEqual(["第一章", "第二章"]);
    expect(result.chapters[0]!.blocks[0]).toEqual(chapter("第一章"));
  });

  it("没有章节标记的文档退化成整篇一章，H2 不会被当成章节", () => {
    const document: JSONContent = {
      type: "doc",
      content: [paragraph("开头"), heading(2, "小标题"), paragraph("正文")],
    };
    const { lead, chapters } = splitDocumentByChapters(document);
    // 整篇只有一章（没有任何 H1 章节标题）：正文与 H2 小标题都留在这一章里，
    // 章节标题由目录/宿主决定，H2 不会被当成章节边界。
    expect(lead).toEqual([]);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe("正文");
    expect(chapters[0]!.blocks).toEqual([
      paragraph("开头"),
      // 归一化会补上显式的 chapterStart: false，层级仍是 H2。
      { ...heading(2, "小标题"), attrs: { level: 2, chapterStart: false } },
      paragraph("正文"),
    ]);
  });

  it("treats a document without headings as one chapter", () => {
    const document: JSONContent = { type: "doc", content: [paragraph("正文")] };
    expect(splitDocumentByChapters(document).chapters).toEqual([
      expect.objectContaining({ title: "正文", start: 0, end: 1 }),
    ]);
  });

  it("归一化是幂等的：再跑一次结果不变", () => {
    const legacy: JSONContent = {
      type: "doc",
      content: [heading(1, "书名"), heading(2, "第一章", true), paragraph("一")],
    };
    const once = normalizeChapterHeadings(legacy);
    expect(normalizeChapterHeadings(once)).toBe(once);
  });

  it("replaces only the requested chapter", () => {
    const document: JSONContent = {
      type: "doc",
      content: [chapter("第一章"), paragraph("旧"), chapter("第二章"), paragraph("保留")],
    };
    expect(
      replaceChapter(document, 0, {
        type: "doc",
        content: [chapter("第一章"), paragraph("新")],
      }).content,
    ).toEqual([chapter("第一章"), paragraph("新"), chapter("第二章"), paragraph("保留")]);
    expect(replaceChapter(document, 99, { type: "doc" })).toEqual(document);
  });

  it("给旧文档追加章节时会先把历史边界迁移到 H1", () => {
    const legacy: JSONContent = {
      type: "doc",
      content: [
        heading(2, "第一章", true),
        paragraph("正文"),
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "小节" }] },
      ],
    };
    const result = appendChapter(legacy, "第二章");
    // 新章节追加在末尾，index 指向它自己。
    expect(result.index).toBe(1);
    expect(result.chapter.title).toBe("第二章");
    // 原章节标题升为 H1，未被搬运的小标题保持 H2，新章节标题是 H1。
    expect(result.document.content?.[0]?.attrs).toMatchObject({
      level: 1,
      chapterStart: true,
    });
    expect(result.document.content?.[2]?.attrs).toMatchObject({
      level: 2,
      chapterStart: false,
    });
    expect(result.document.content?.[3]?.attrs).toMatchObject({
      level: 1,
      chapterStart: true,
    });
    expect(splitDocumentByChapters(result.document).chapters).toHaveLength(2);
    // 追加后再追加一次仍然稳定（不会把旧章节标题又搬回去）。
    const twice = appendChapter(result.document, "第三章");
    expect(twice.document.content?.[0]?.attrs).toMatchObject({ level: 1 });
    expect(splitDocumentByChapters(twice.document).chapters).toHaveLength(3);
  });

  it("给没有章节标记的文档追加章节时，原有内容成为第一章", () => {
    const withHeading: JSONContent = {
      type: "doc",
      content: [heading(2, "旧标题"), paragraph("只有正文")],
    };
    const result = appendChapter(withHeading, "第一章");
    expect(result.index).toBe(1);
    const chapters = splitDocumentByChapters(result.document).chapters;
    expect(chapters).toHaveLength(2);
    expect(chapters[0]!.title).toBe("旧标题");
    expect(chapters[1]!.title).toBe("第一章");

    // 完全没有标题的文档：追加时补一个空章节标题，原有正文留在第一章里。
    const noHeading = appendChapter({ type: "doc", content: [paragraph("只有正文")] }, "第一章");
    expect(splitDocumentByChapters(noHeading.document).chapters).toHaveLength(2);
  });

  it("removes first and last chapters and ignores an invalid index", () => {
    const document: JSONContent = {
      type: "doc",
      content: [chapter("第一章"), paragraph("一"), chapter("第二章"), paragraph("二")],
    };
    const first = removeChapter(document, 0);
    expect(first.removed?.title).toBe("第一章");
    expect(splitDocumentByChapters(first.document).chapters[0]?.title).toBe("第二章");
    const last = removeChapter(document, 1);
    expect(last.removed?.title).toBe("第二章");
    expect(splitDocumentByChapters(last.document).chapters).toHaveLength(1);
    expect(removeChapter(document, 99)).toEqual({ document, removed: null });
  });
});
