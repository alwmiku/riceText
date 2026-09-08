import { describe, expect, it } from "vitest";
import { sanitizeDocument } from "./sanitize.js";
import { DOMSerializer } from "@tiptap/pm/model";
import { readerTop, readerBottom } from "./reader-excerpt.js";
import { TiptapDocumentSchema } from "@ricetext/contracts";

function attrs(raw: Record<string, unknown>) {
  return sanitizeDocument({
    type: "doc",
    content: [{ type: "novelExcerpt", attrs: raw, content: [{ type: "paragraph" }] }],
  }).content?.[0]?.attrs;
}

describe("小说摘录阅读信息", () => {
  it.each(["sfacg", "ciweimao"])("%s 沿用现有契约保留元数据并根据实际页数显示进度", (variant) => {
    const raw = {
      variant,
      bookTitle: "远方来信",
      chapterTitle: "第七章",
      sourceUrl: "https://example.com/book",
      readerTime: "10:17",
      batteryLevel: 75,
      pageLabel: "6/8",
      progressLabel: "16%",
      headerLabel: "旧自定义提示",
    };
    const content = sanitizeDocument({
      type: "doc",
      content: [
        {
          type: "novelExcerpt",
          attrs: raw,
          content: [{ type: "paragraph", content: [{ type: "text", text: "摘录正文" }] }],
        },
      ],
    });
    expect(TiptapDocumentSchema.safeParse(content).success).toBe(true);
    expect(content.content?.[0]?.attrs).toMatchObject(raw);
    const page = DOMSerializer.renderSpec(document, [
      "aside",
      {},
      ...readerTop(raw),
      readerBottom(raw, { index: 2, count: 8 }),
    ]).dom as HTMLElement;
    expect(page.querySelectorAll(".rt-reader-book-title")).toHaveLength(1);
    expect(page.querySelector(".rt-reader-book-title a")?.getAttribute("href")).toBe(raw.sourceUrl);
    expect(page.querySelector(".rt-reader-progress")?.textContent).toContain("3/8");
    expect(page.querySelector(".rt-reader-percentage")?.textContent).toBe(
      variant === "ciweimao" ? "37.50%" : "38%",
    );
    expect(page.querySelector(".rt-reader-clock")?.textContent).toBe("10:17");
    expect(page.querySelector(".rt-reader-header-label")).toBeNull();
    expect(page.querySelector("button, [role=button], [data-thread-id]")).toBeNull();
    if (variant === "sfacg") {
      expect(page.querySelector(".rt-reader-clock")?.firstElementChild?.className).toBe(
        "rt-reader-battery",
      );
      expect(page.querySelector("footer .rt-reader-book-title")?.textContent).toBe("《远方来信》");
      expect(page.querySelector(".rt-reader-moon")?.getAttribute("aria-hidden")).toBe("true");
    } else {
      expect(page.querySelector(".rt-reader-back")).toBeNull();
      expect(page.querySelector(".rt-reader-danmaku")?.textContent).toBe("开启弹幕");
      expect(page.querySelector(".rt-reader-danmaku")?.getAttribute("aria-hidden")).toBe("true");
    }
  });
  it("provides backward-compatible display defaults", () => {
    expect(attrs({ variant: "fanqie" })).toMatchObject({
      readerTime: "",
      batteryLevel: 100,
      pageLabel: "1/1",
      progressLabel: "",
      headerLabel: "",
    });
  });
  it("preserves zero battery, custom labels, and explicitly empty text", () => {
    expect(
      attrs({
        variant: "qidian",
        readerTime: "",
        batteryLevel: 0,
        pageLabel: "2/20",
        progressLabel: "1.0%",
        headerLabel: "Custom",
      }),
    ).toMatchObject({
      readerTime: "",
      batteryLevel: 0,
      pageLabel: "2/20",
      progressLabel: "1.0%",
      headerLabel: "Custom",
    });
  });
  it.each([
    [110, 100],
    [-10, 0],
    [45.7, 46],
    [Number.NaN, 100],
    ["50", 100],
  ])("bounds battery %s to %s", (input, expected) => {
    expect(attrs({ batteryLevel: input })?.batteryLevel).toBe(expected);
  });
  it("bounds display text lengths and rejects non-string text", () => {
    const result = attrs({
      readerTime: "x".repeat(100),
      pageLabel: "x".repeat(100),
      progressLabel: "x".repeat(100),
      headerLabel: "x".repeat(100),
    });
    expect(result?.readerTime).toHaveLength(16);
    expect(result?.pageLabel).toHaveLength(40);
    expect(result?.progressLabel).toHaveLength(24);
    expect(result?.headerLabel).toHaveLength(80);
    expect(attrs({ readerTime: 123, headerLabel: {} })).toMatchObject({
      readerTime: "",
      headerLabel: "",
    });
  });
});
