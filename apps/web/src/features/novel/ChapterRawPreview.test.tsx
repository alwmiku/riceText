import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(520);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(220);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it("jumps to the selected chapter head and tail with context", async () => {
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
    const viewportMeta = screen.getByText(/已加载原文 5,000 字/).textContent;
    const viewportMatch = viewportMeta?.match(/当前显示 \[(\d+), ([\d,]+)\)/);
    expect(viewportMatch).not.toBeNull();
    expect(Number(viewportMatch?.[1])).toBeLessThanOrEqual(250);
    expect(Number(viewportMatch?.[2]?.replaceAll(",", ""))).toBeGreaterThan(
      250,
    );
    const headScrollTop = scrollArea.scrollTop;

    fireEvent.click(screen.getByRole("button", { name: "章尾" }));
    expect(scrollArea.scrollTop).toBeGreaterThan(headScrollTop + 1000);
    const tailMarker = screen.getByText("▲ 第 1 章结束");
    expect(tailMarker).toHaveAttribute("data-raw-anchor", "end-3750");
    await waitFor(() => {
      const tailViewportMeta = screen.getByText(
        /已加载原文 5,000 字/,
      ).textContent;
      const tailViewportMatch = tailViewportMeta?.match(
        /当前显示 \[([\d,]+), ([\d,]+)\)/,
      );
      const tailVisibleStart = Number(
        tailViewportMatch?.[1]?.replaceAll(",", ""),
      );
      const tailVisibleEnd = Number(
        tailViewportMatch?.[2]?.replaceAll(",", ""),
      );
      expect(tailVisibleStart).toBeLessThanOrEqual(3550);
      expect(tailVisibleEnd).toBeGreaterThanOrEqual(3750);
    });
  });

  it("keeps the reimport prompt when raw text is missing", () => {
    render(
      <ChapterRawPreview rawText={null} chapters={chapters} activeIndex={0} />,
    );

    expect(screen.getByText("无原文数据，请重新导入文件")).toBeInTheDocument();
    expect(screen.queryByLabelText("完整原文滚动区")).not.toBeInTheDocument();
  });

  it("uses a several-hundred-character fallback viewport at zero size", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(0);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(0);

    render(
      <ChapterRawPreview
        rawText={"字".repeat(5000)}
        chapters={longChapter}
        activeIndex={0}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "章首" }));
    const viewportMeta = screen.getByText(/已加载原文 5,000 字/).textContent;
    const viewportMatch = viewportMeta?.match(/当前显示 \[(\d+), ([\d,]+)\)/);
    const visibleStart = Number(viewportMatch?.[1]);
    const visibleEnd = Number(viewportMatch?.[2]?.replaceAll(",", ""));

    expect(viewportMatch).not.toBeNull();
    expect(visibleStart).toBeLessThanOrEqual(250);
    expect(visibleEnd - visibleStart).toBeGreaterThanOrEqual(500);
  });

  it("keeps local scroll space when refining a large raw offset", async () => {
    render(
      <ChapterRawPreview
        rawText={"字".repeat(20_000_000)}
        chapters={[
          {
            id: "chapter-large",
            title: "大偏移章节",
            charCount: 1000,
            start: 16_000_250,
            end: 16_001_250,
            preview: "大偏移正文",
          },
        ]}
        activeIndex={0}
      />,
    );

    const scrollArea = screen.getByLabelText("完整原文滚动区");
    const startMarker = screen.getByText(/大偏移章节.*开始/);
    vi.spyOn(scrollArea, "getBoundingClientRect").mockReturnValue({
      ...scrollArea.getBoundingClientRect(),
      top: 100,
      bottom: 320,
      height: 220,
    });
    vi.spyOn(startMarker, "getBoundingClientRect").mockReturnValue({
      ...startMarker.getBoundingClientRect(),
      top: 500,
      bottom: 520,
      height: 20,
    });

    fireEvent.click(screen.getByRole("button", { name: "章首" }));

    await waitFor(() => expect(scrollArea.scrollTop).toBeGreaterThan(1_000_300));
    expect(startMarker).toHaveAttribute(
      "data-raw-anchor",
      "start-16000250",
    );
    expect(startMarker).toBeInTheDocument();
    const flowWindow = screen.getByTestId("raw-flow-window");
    const flowStart = Number(flowWindow.getAttribute("data-raw-start"));
    expect(flowStart).toBeLessThanOrEqual(16_000_250);
    expect(16_000_250 - flowStart).toBeLessThanOrEqual(4_000);

    const headScrollTop = scrollArea.scrollTop;
    fireEvent.click(screen.getByRole("button", { name: "章尾" }));
    await waitFor(() => expect(scrollArea.scrollTop).not.toBe(headScrollTop));
    const endMarker = screen.getByText("▲ 第 1 章结束");
    expect(endMarker).toHaveAttribute("data-raw-anchor", "end-16001250");
    expect(endMarker).toBeInTheDocument();
  });

  it("flows adjacent virtual blocks without detaching boundary markers", () => {
    const rawText = `${"前".repeat(20)}${"章".repeat(3500)}${"后".repeat(200)}`;
    render(
      <ChapterRawPreview
        rawText={rawText}
        chapters={[
          {
            id: "chapter-cross-block",
            title: "跨块章节",
            charCount: 3500,
            start: 20,
            end: 3520,
            preview: "章节正文",
          },
        ]}
        activeIndex={0}
      />,
    );

    const flowWindow = screen.getByTestId("raw-flow-window");
    expect(flowWindow).toHaveStyle({ position: "absolute" });
    for (const block of Array.from(flowWindow.children)) {
      expect(block).not.toHaveStyle({ position: "absolute" });
    }

    const scrollText =
      screen.getByLabelText("完整原文滚动区").textContent ?? "";
    const startMarkerIndex = scrollText.indexOf("▼ 第 1 章");
    const endMarkerIndex = scrollText.indexOf("▲ 第 1 章结束");
    const suffixIndex = scrollText.indexOf("后后后");
    expect(startMarkerIndex).toBeGreaterThanOrEqual(0);
    expect(endMarkerIndex).toBeGreaterThan(startMarkerIndex);
    expect(suffixIndex).toBeGreaterThan(endMarkerIndex);
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
    const marker = screen.getByText("▼ 第 1 章「第一章 起点」开始 [20, 40)");
    expect(marker).toHaveAttribute("data-raw-anchor", "start-20");
    const markerIndex = scrollText.indexOf(marker.textContent ?? "");
    const chapterTextIndex = scrollText.indexOf("章章章");

    expect(prefixIndex).toBeGreaterThanOrEqual(0);
    expect(markerIndex).toBeGreaterThan(prefixIndex);
    expect(chapterTextIndex).toBeGreaterThan(markerIndex);
  });
});
