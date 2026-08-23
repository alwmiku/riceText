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
            chapterId: "imported-chapter-1",
            title: "第一章 起点",
            text: "第一章正文",
            order: 0,
          },
        },
        {
          type: "longTextBlock",
          attrs: {
            chapterId: "imported-chapter-2",
            title: "第二章 终点",
            text: "第二章正文",
            order: 1,
          },
        },
      ],
    });
  });

  it("retains a million-character chapter without expanding it into paragraphs", () => {
    const source = "字".repeat(1_000_000);
    const document = createLongTextDocument(source);
    const block = document.content?.[0] as {
      type: string;
      attrs: { text: string };
    };

    expect(document.content).toHaveLength(1);
    expect(block.type).toBe("longTextBlock");
    expect(block.attrs.text).toHaveLength(1_000_000);
  });
});
