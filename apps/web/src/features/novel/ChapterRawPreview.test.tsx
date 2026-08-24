import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChapterRawPreview } from "./ChapterRawPreview";
import type { CoverageChapter } from "./ChapterCoverageDialog";

class ResizeObserverStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

const chapters: CoverageChapter[] = [
  {
    id: "chapter-1",
    title: "第一章 起点",
    charCount: 2000,
    start: 0,
    end: 2000,
    preview: "第一章正文",
  },
  {
    id: "chapter-2",
    title: "第二章 远行",
    charCount: 3500,
    start: 2000,
    end: 5500,
    preview: "第二章正文",
  },
];

const longChapter: CoverageChapter[] = [
  {
    id: "chapter-long",
    title: "长章",
    charCount: 3500,
    start: 250,
    end: 3750,
    preview: "长章正文",
  },
];

describe("ChapterRawPreview", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  it("shows raw text and chapter audit metadata", () => {
    render(
      <ChapterRawPreview
        rawText={"字".repeat(6000)}
        chapters={chapters}
        activeIndex={1}
      />,
    );

    expect(screen.getByText("原文对照（虚拟滚动）")).toBeInTheDocument();
    expect(screen.getByText(/已加载原文 6,000 字/)).toBeInTheDocument();
    expect(screen.getByText(/共 3 块/)).toBeInTheDocument();
    expect(screen.getByText(/当前章 2 · 3,500 字/)).toBeInTheDocument();
    expect(screen.getAllByText(/\[2,000, 5,500\)/).length).toBeGreaterThan(0);
    expect(screen.getByText(/单章上限 50,000 字/)).toBeInTheDocument();
  });

  it("jumps to the selected chapter head and tail", () => {
    render(
      <ChapterRawPreview
        rawText={"字".repeat(5000)}
        chapters={longChapter}
        activeIndex={0}
      />,
    );

    const scrollArea = screen.getByLabelText("完整原文滚动区");

    fireEvent.click(screen.getByRole("button", { name: "章首" }));
    expect(scrollArea.scrollTop).toBeGreaterThan(0);
    const headScrollTop = scrollArea.scrollTop;

    fireEvent.click(screen.getByRole("button", { name: "章尾" }));
    expect(scrollArea.scrollTop).toBeGreaterThan(headScrollTop + 1000);
  });

  it("keeps the reimport prompt when raw text is missing", () => {
    render(
      <ChapterRawPreview rawText={null} chapters={chapters} activeIndex={0} />,
    );

    expect(screen.getByText("无原文数据，请重新导入文件")).toBeInTheDocument();
    expect(screen.queryByLabelText("完整原文滚动区")).not.toBeInTheDocument();
  });
  it("places the chapter start marker inside a block at the exact boundary", () => {
    const rawText = `${"前".repeat(20)}${"章".repeat(20)}${"后".repeat(20)}`;
    render(
      <ChapterRawPreview
        rawText={rawText}
        chapters={[
          {
            id: "chapter-mid-block",
            title: "第一章 起点",
            charCount: 20,
            start: 20,
            end: 40,
            preview: "章节正文",
          },
        ]}
        activeIndex={0}
      />,
    );

    const scrollText =
      screen.getByLabelText("完整原文滚动区").textContent ?? "";
    const prefixIndex = scrollText.indexOf("前前前");
    const markerIndex = scrollText.indexOf(
      "▼ 第 1 章「第一章 起点」开始 [20, 40)",
    );
    const chapterTextIndex = scrollText.indexOf("章章章");

    expect(prefixIndex).toBeGreaterThanOrEqual(0);
    expect(markerIndex).toBeGreaterThan(prefixIndex);
    expect(chapterTextIndex).toBeGreaterThan(markerIndex);
  });
});
