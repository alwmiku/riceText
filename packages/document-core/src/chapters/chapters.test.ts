import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import {
  appendChapter,
  getChapterRange,
  removeChapter,
  replaceChapter,
  splitDocumentByChapters,
} from "./index.js";

const heading = (level: number, text: string, chapterStart = false): JSONContent => ({
  type: "heading",
  attrs: chapterStart ? { level, chapterStart: true } : { level },
  content: [{ type: "text", text }],
});
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

describe("chapter document operations", () => {
  it("uses h2 boundaries for legacy documents and preserves lead content", () => {
    const document: JSONContent = {
      type: "doc",
      content: [
        heading(1, "书名"),
        heading(2, "第一章"),
        paragraph("一"),
        heading(2, "第二章"),
        paragraph("二"),
      ],
    };
    const result = splitDocumentByChapters(document);
    expect(result.lead).toEqual([heading(1, "书名")]);
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(["第一章", "第二章"]);
    expect(getChapterRange(document, 1)).toEqual({ start: 3, end: 5 });
  });

  it("uses only explicit markers once any marker exists", () => {
    const document: JSONContent = {
      type: "doc",
      content: [
        heading(1, "第一章", true),
        paragraph("正文"),
        heading(2, "小节"),
        heading(2, "第二章", true),
      ],
    };
    const chapters = splitDocumentByChapters(document).chapters;
    expect(chapters).toHaveLength(2);
    expect(chapters[0]!.blocks).toContainEqual(heading(2, "小节"));
  });

  it("treats a document without headings as one chapter", () => {
    const document: JSONContent = { type: "doc", content: [paragraph("正文")] };
    expect(splitDocumentByChapters(document).chapters).toEqual([
      expect.objectContaining({ title: "正文", start: 0, end: 1 }),
    ]);
  });

  it("replaces only the requested chapter", () => {
    const document: JSONContent = {
      type: "doc",
      content: [
        heading(2, "第一章", true),
        paragraph("旧"),
        heading(2, "第二章", true),
        paragraph("保留"),
      ],
    };
    expect(
      replaceChapter(document, 0, {
        type: "doc",
        content: [heading(2, "第一章", true), paragraph("新")],
      }).content,
    ).toEqual([
      heading(2, "第一章", true),
      paragraph("新"),
      heading(2, "第二章", true),
      paragraph("保留"),
    ]);
    expect(replaceChapter(document, 99, { type: "doc" })).toBe(document);
  });

  it("migrates legacy boundaries before appending a chapter", () => {
    const document: JSONContent = {
      type: "doc",
      content: [heading(2, "第一章"), paragraph("正文")],
    };
    const result = appendChapter(document, "第二章");
    expect(result.index).toBe(1);
    expect(result.chapter.title).toBe("第二章");
    expect(result.document.content?.[0]?.attrs?.chapterStart).toBe(true);
    expect(splitDocumentByChapters(result.document).chapters).toHaveLength(2);
  });

  it("removes first and last chapters and ignores an invalid index", () => {
    const document: JSONContent = {
      type: "doc",
      content: [
        heading(2, "第一章", true),
        paragraph("一"),
        heading(2, "第二章", true),
        paragraph("二"),
      ],
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
