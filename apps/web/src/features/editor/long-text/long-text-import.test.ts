import { describe, expect, it } from "vitest";

import { createLongTextDocument } from "./long-text-import";

describe("createLongTextDocument", () => {
  it("converts detected chapters to long-text blocks", async () => {
    const document = await createLongTextDocument(
      "第一章 起点\n第一章正文\n第二章 终点\n第二章正文",
      "demo-post",
    );

    expect(document).toMatchObject({
      type: "doc",
      content: [
        {
          type: "longTextBlock",
          attrs: {
            chapterId: expect.stringMatching(/^chapter_[0-9a-f-]{36}$/),
            title: "第一章 起点",
            text: "第一章正文",
            order: 0,
            start: 0,
            end: 13,
          },
        },
        {
          type: "longTextBlock",
          attrs: {
            chapterId: expect.stringMatching(/^chapter_[0-9a-f-]{36}$/),
            title: "第二章 终点",
            text: "第二章正文",
            order: 1,
            start: 13,
            end: 25,
          },
        },
      ],
    });
  });

  it("每次导入都铸造新身份：身份不再由内容哈希决定", async () => {
    const source = "第一章 起点\n正文";
    const first = await createLongTextDocument(source, "article-a");
    const second = await createLongTextDocument(source, "article-b");
    const firstId = String(first.content?.[0]?.attrs?.chapterId);
    const secondId = String(second.content?.[0]?.attrs?.chapterId);

    expect(firstId).toMatch(/^chapter_[0-9a-f-]{36}$/);
    expect(secondId).toMatch(/^chapter_[0-9a-f-]{36}$/);
    expect(firstId).not.toBe(secondId);
  });

  it("同内容的多章也各自拿到不同身份", async () => {
    const source = "第一章 相同\n正文\n第一章 相同\n正文";
    const document = await createLongTextDocument(source, "article-a");
    const ids = document.content?.map((node) => node.attrs?.chapterId);
    expect(ids).toHaveLength(2);
    expect(ids?.[0]).not.toBe(ids?.[1]);
  });

  it("keeps leading extra material with its original range", async () => {
    const document = await createLongTextDocument(
      "番外：序曲\n番外正文\n第一章 起点\n正文",
      "demo-post",
    );
    const blocks = document.content as Array<{
      attrs: { title: string; start: number; end: number };
    }>;

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.attrs.title).toBe("卷首");
    expect(blocks[0]?.attrs.start).toBe(0);
    expect(blocks[1]?.attrs.start).toBe(blocks[0]?.attrs.end);
  });

  it("splits an oversized chapter without expanding it into paragraphs", async () => {
    const source = "字".repeat(50_001);
    const document = await createLongTextDocument(source, "demo-post");
    const blocks = document.content as Array<{
      type: string;
      attrs: { text: string };
    }>;

    expect(blocks).toHaveLength(2);
    expect(blocks.every((block) => block.type === "longTextBlock")).toBe(true);
    expect(blocks.every((block) => block.attrs.text.length <= 50_000)).toBe(
      true,
    );
  });
});
