import { describe, expect, it } from "vitest";
import {
  containsLongTextBlocks,
  convertLongTextBlocksToChapters,
} from "./long-text-conversion";

describe("convertLongTextBlocksToChapters", () => {
  it("converts local blocks to standard headings and line-preserving paragraphs", () => {
    const converted = convertLongTextBlocksToChapters({
      type: "doc",
      content: [
        {
          type: "longTextBlock",
          attrs: {
            chapterId: "local-one",
            title: "第一章 起点",
            text: "第一行\r\n\r\n第三行\n",
          },
        },
      ],
    });

    expect(containsLongTextBlocks(converted)).toBe(false);
    expect(converted.content).toEqual([
      {
        type: "heading",
        attrs: { textAlign: "left", chapterStart: true, level: 2 },
        content: [{ type: "text", text: "第一章 起点" }],
      },
      {
        type: "paragraph",
        attrs: { textAlign: "left" },
        content: [{ type: "text", text: "第一行" }],
      },
      { type: "paragraph", attrs: { textAlign: "left" } },
      {
        type: "paragraph",
        attrs: { textAlign: "left" },
        content: [{ type: "text", text: "第三行" }],
      },
      { type: "paragraph", attrs: { textAlign: "left" } },
    ]);
  });

  it("leaves ordinary chapter documents unchanged", () => {
    const document = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }],
    };
    expect(convertLongTextBlocksToChapters(document)).toEqual(document);
  });
});
