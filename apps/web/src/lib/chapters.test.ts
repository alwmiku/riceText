import { describe, expect, it } from "vitest";
import type { JSONContent } from "@ricetext/editor-core";
import {
  ensureChapterIdentity,
  mergeChapterRange,
  resolveChapterRange,
  splitDocumentByHeadings,
} from "./chapters";

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

  it("按稳定 ID 解析章节范围并只替换该区间", () => {
    const tagged = (text: string, chapterId: string): JSONContent => ({
      type: "heading",
      attrs: { level: 1, chapterStart: true, chapterId },
      content: [{ type: "text", text }],
    });
    const doc: JSONContent = {
      type: "doc",
      content: [
        tagged("第一章", "chapter_a"),
        paragraph("旧正文"),
        tagged("第二章", "chapter_b"),
        paragraph("保留"),
      ],
    };
    const range = resolveChapterRange(doc, "chapter_a");
    expect(range).toEqual({ start: 0, end: 2 });
    const next = mergeChapterRange(
      doc,
      range!,
      { type: "doc", content: [tagged("第一章", "chapter_a"), paragraph("新正文")] },
      "chapter_a",
    );
    expect(next).toEqual({
      type: "doc",
      content: [
        tagged("第一章", "chapter_a"),
        paragraph("新正文"),
        tagged("第二章", "chapter_b"),
        paragraph("保留"),
      ],
    });
    // 未知身份不做位置猜测；旧正文才允许按服务端目录顺序回退。
    expect(resolveChapterRange(doc, "chapter_missing")).toBeNull();
    expect(resolveChapterRange(doc, "chapter_first", 0)).toBeNull();
    expect(
      resolveChapterRange({ type: "doc", content: [chapter("第一章"), paragraph("旧正文")] }, "chapter_first", 0),
    ).toEqual({ start: 0, end: 2 });
  });
});

describe("ensureChapterIdentity", () => {
  const tagged = (text: string, chapterId: string): JSONContent => ({
    type: "heading",
    attrs: { level: 1, chapterStart: true, chapterId },
    content: [{ type: "text", text }],
  });
  const idOf = (node: JSONContent): unknown => node.attrs?.chapterId;

  it("补铸一次后就固定下来，后续调用不再改动正文", () => {
    const document: JSONContent = {
      type: "doc",
      content: [chapter("第一章"), paragraph("正文")],
    };
    const first = ensureChapterIdentity(document);
    expect(first.changed).toBe(true);
    expect(idOf(first.content.content![0]!)).toMatch(/^chapter_[0-9a-f-]{36}$/u);

    const second = ensureChapterIdentity(first.content);
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
  });

  it("第一次保存复用服务器目录里的身份，而不是另铸一个", () => {
    // 旧正文没有 chapterId，但目录里已经有这一章：必须沿用目录 id，
    // 否则目录行会变成孤儿，章节历史与版本号全部错位。
    const result = ensureChapterIdentity(
      { type: "doc", content: [chapter("第一章"), chapter("第二章")] },
      ({ position }) => ["stable-0", "stable-1"][position],
    );
    expect(result.content.content!.map(idOf)).toEqual(["stable-0", "stable-1"]);
  });

  it("目录里没有的章节才现铸，且不与已有身份冲突", () => {
    const result = ensureChapterIdentity(
      { type: "doc", content: [tagged("第一章", "stable-0"), chapter("第二章")] },
      () => undefined,
    );
    const ids = result.content.content!.map(idOf) as string[];
    expect(ids[0]).toBe("stable-0");
    expect(ids[1]).toMatch(/^chapter_[0-9a-f-]{36}$/u);
    expect(ids[1]).not.toBe(ids[0]);
  });

  it("移动章节只改顺序：身份跟着标题节点走", () => {
    const document: JSONContent = {
      type: "doc",
      content: [tagged("第一章", "stable-0"), tagged("第二章", "stable-1")],
    };
    const moved: JSONContent = {
      type: "doc",
      content: [document.content![1]!, document.content![0]!],
    };
    const result = ensureChapterIdentity(moved);
    expect(result.changed).toBe(false);
    expect(result.content.content!.map(idOf)).toEqual(["stable-1", "stable-0"]);
  });

  it("没有章节标题的正文保持原样", () => {
    const document: JSONContent = {
      type: "doc",
      content: [paragraph("整篇正文")],
    };
    const result = ensureChapterIdentity(document);
    expect(result.changed).toBe(false);
    expect(result.content).toEqual(document);
  });

  it("改标题与改正文都不影响身份", () => {
    const first = ensureChapterIdentity({
      type: "doc",
      content: [chapter("第一章"), paragraph("初稿")],
    });
    const id = idOf(first.content.content![0]!);
    const edited: JSONContent = {
      type: "doc",
      content: [
        { ...chapter("改名后的第一章"), attrs: first.content.content![0]!.attrs },
        paragraph("改过的正文"),
      ],
    };
    const result = ensureChapterIdentity(edited);
    expect(result.changed).toBe(false);
    expect(idOf(result.content.content![0]!)).toBe(id);
  });
});
