import { describe, expect, it } from "vitest";

import { createLongTextDocument } from "./long-text-import";

describe("createLongTextDocument", () => {
  it("converts detected chapters to long-text blocks", () => {
    const document = createLongTextDocument(
      "第一章 起点\n第一章正文\n第二章 终点\n第二章正文",
    );

    expect(document).toMatchObject({
      type: "doc",
      content: [
        {
          type: "longTextBlock",
          attrs: {
            chapterId: "local-chapter-1",
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
            chapterId: "local-chapter-2",
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

  it("keeps leading extra material with its original range", () => {
    const document = createLongTextDocument(
      "番外：序曲\n番外正文\n第一章 起点\n正文",
    );
    const blocks = document.content as Array<{
      attrs: { title: string; start: number; end: number };
    }>;

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.attrs.title).toBe("卷首");
    expect(blocks[0]?.attrs.start).toBe(0);
    expect(blocks[1]?.attrs.start).toBe(blocks[0]?.attrs.end);
  });

  it("splits an oversized chapter without expanding it into paragraphs", () => {
    const source = "字".repeat(50_001);
    const document = createLongTextDocument(source);
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
