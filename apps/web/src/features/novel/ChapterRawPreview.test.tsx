import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChapterRawPreview } from "./ChapterRawPreview";
import { collectRawGaps } from "./raw-coverage";
import type { CoverageChapter } from "./ChapterCoverageDialog";

// jsdom 没有 Canvas 2D，@chenglou/pretext 的 prepare() 会直接抛错；
// 这里用与真实语义一致的确定性实现替换（每字符 13px 宽、按宽度折行），
// 单元测试聚焦本组件的分块/滚动/标记逻辑；真实测量由 e2e 在浏览器验证。
vi.mock("@chenglou/pretext", () => {
  const CHAR_WIDTH = 13;
  const prepare = (text: string, _font?: string) => ({ text });
  const layout = (
    prepared: { text: string },
    maxWidth: number,
    lineHeight: number,
  ) => {
    if (prepared.text.length === 0) return { lineCount: 0, height: 0 };
    const charsPerLine = Math.max(1, Math.floor(maxWidth / CHAR_WIDTH));
    const lineCount = Math.ceil(prepared.text.length / charsPerLine);
    return { lineCount, height: lineCount * lineHeight };
  };
  return { prepare, layout };
});

// 与组件常量一致的确定性测量参数。jsdom 下 react-window 以 defaultHeight(360)
// 同时作为容器宽回退（内部 width 缺省时取默认值），故测量宽度 =
// 360 - 16（行内边距 px-2）- 0（jsdom 无滚动条）= 344。
const TEXT_CPL = Math.floor((360 - 16) / 13); // 26
const MARKER_CPL = Math.floor((360 - 16 - 12 - 3) / 13); // 25
const GAP_CPL = Math.floor((360 - 16 - 12) / 13); // 25
const textHeight = (chars: number) =>
  Math.max(22, Math.ceil(chars / TEXT_CPL) * 22);
const markerHeight = (text: string) =>
  12 + Math.max(16, Math.ceil(text.length / MARKER_CPL) * 16);
const gapLabelHeight = (text: string) =>
  8 + Math.max(14, Math.ceil(text.length / GAP_CPL) * 14);

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

const scrollArea = () => screen.getByLabelText("完整原文滚动区");

describe("ChapterRawPreview", () => {
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
    expect(
      screen.getByText("▼ 第 2 章「第二章 远行」开始 [2,000, 5,500)"),
    ).toHaveAttribute("data-raw-anchor", "start-2000");
    expect(screen.getByText("▲ 第 2 章结束")).toHaveAttribute(
      "data-raw-anchor",
      "end-5500",
    );
    expect(screen.getByText(/单章上限 50,000 字/)).toBeInTheDocument();
    expect(screen.getByText("全文已切分")).toBeInTheDocument();
    expect(scrollArea().textContent?.length).toBeGreaterThan(2000);
  });

  it("jumps to the selected chapter head and tail with context", async () => {
    render(
      <ChapterRawPreview
        rawText={"字".repeat(5000)}
        chapters={longChapter}
        activeIndex={0}
      />,
    );

    const area = scrollArea();
    // 章首：空洞标签(22) + 空洞正文 250 字(220) = 242px 处是章首标记，
    // 目标滚到视口顶部上方 8px。
    const startAnchorTop = gapLabelHeight("未切分 [0, 250) 250 字") +
      textHeight(250);
    fireEvent.click(screen.getByRole("button", { name: "章首" }));
    expect(area.scrollTop).toBe(startAnchorTop - 8);
    fireEvent.scroll(area);
    await waitFor(() =>
      expect(screen.getByText(/已加载原文 5,000 字/)).toHaveTextContent(
        /当前显示 \[0, 2,000\)/,
      ),
    );

    const headScrollTop = area.scrollTop;
    fireEvent.click(screen.getByRole("button", { name: "章尾" }));
    // 章尾：第一块高 1782px，第二块内章尾正文 1750 字 = 1496px 处是结束标记；
    // 结束标记按视口高度 360 与标记高度 28 落到距底部 56px 处。
    const rowOneOffset = textHeight(250) +
      gapLabelHeight("未切分 [0, 250) 250 字") +
      markerHeight("▼ 第 1 章「长章」开始 [250, 3,750)") +
      textHeight(1750);
    const endAnchorTop = textHeight(1750);
    const endMarkerHeight = markerHeight("▲ 第 1 章结束");
    expect(area.scrollTop).toBe(
      rowOneOffset + endAnchorTop - Math.max(8, 360 - endMarkerHeight - 56),
    );
    expect(area.scrollTop).toBeGreaterThan(headScrollTop + 1000);
    fireEvent.scroll(area);
    await waitFor(() =>
      expect(screen.getByText(/已加载原文 5,000 字/)).toHaveTextContent(
        /当前显示 \[2,000, 4,000\)/,
      ),
    );
    const tailMarker = screen.getByText("▲ 第 1 章结束");
    expect(tailMarker).toHaveAttribute("data-raw-anchor", "end-3750");
    expect(tailMarker).toBeInTheDocument();
  });

  it("keeps the reimport prompt when raw text is missing", () => {
    render(
      <ChapterRawPreview rawText={null} chapters={chapters} activeIndex={0} />,
    );

    expect(screen.getByText("无原文数据，请重新导入文件")).toBeInTheDocument();
    expect(screen.queryByLabelText("完整原文滚动区")).not.toBeInTheDocument();
  });

  it("uses the fallback viewport metrics when the container size is unmeasurable", async () => {
    render(
      <ChapterRawPreview
        rawText={"字".repeat(5000)}
        chapters={longChapter}
        activeIndex={0}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "章首" }));
    fireEvent.scroll(scrollArea());
    await waitFor(() =>
      expect(screen.getByText(/已加载原文 5,000 字/)).toHaveTextContent(
        /当前显示 \[0, 2,000\)/,
      ),
    );
  });

  it("scrolls precisely to chapter head and tail at a large raw offset", async () => {
    const rawIndex = 16_000_250;
    render(
      <ChapterRawPreview
        rawText={"字".repeat(20_000_000)}
        chapters={[
          {
            id: "chapter-large",
            title: "大偏移章节",
            charCount: 1000,
            start: rawIndex,
            end: 16_001_250,
            preview: "大偏移正文",
          },
        ]}
        activeIndex={0}
      />,
    );

    const area = scrollArea();
    // 前 8000 块每块带 2 行空洞标签(36) + 2000 字正文(1694) = 1730px；
    // 第 8000 块起始空洞标签(36) + 250 字(220) 之后是章首标记。
    const rowHeight = gapLabelHeight("未切分 [0, 16,000,250) 16,000,250 字") +
      textHeight(2000);
    const blockIndex = Math.floor(rawIndex / 2000);
    const headAnchorTop =
      gapLabelHeight("未切分 [0, 16,000,250) 16,000,250 字") +
      textHeight(250);
    fireEvent.click(screen.getByRole("button", { name: "章首" }));
    expect(area.scrollTop).toBe(blockIndex * rowHeight + headAnchorTop - 8);
    fireEvent.scroll(area);
    const startMarker = await screen.findByText(/大偏移章节.*开始/);
    expect(startMarker).toHaveAttribute("data-raw-anchor", "start-16000250");
    await waitFor(() =>
      expect(screen.getByText(/已加载原文 20,000,000 字/)).toHaveTextContent(
        /当前显示 \[16,000,000, 16,002,000\)/,
      ),
    );

    const headScrollTop = area.scrollTop;
    fireEvent.click(screen.getByRole("button", { name: "章尾" }));
    // 章尾标记在章首标记(256) + 章首标记高度(44) + 1000 字正文(858) 处。
    const endAnchorTop =
      headAnchorTop +
      markerHeight("▼ 第 1 章「大偏移章节」开始 [16,000,250, 16,001,250)") +
      textHeight(1000);
    const endMarkerHeight = markerHeight("▲ 第 1 章结束");
    expect(area.scrollTop).toBe(
      blockIndex * rowHeight +
        endAnchorTop -
        Math.max(8, 360 - endMarkerHeight - 56),
    );
    expect(area.scrollTop).not.toBe(headScrollTop);
    fireEvent.scroll(area);
    const endMarker = await screen.findByText("▲ 第 1 章结束");
    expect(endMarker).toHaveAttribute("data-raw-anchor", "end-16001250");
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

    const startMarker = screen.getByText(/▼ 第 1 章「跨块章节」开始/);
    expect(startMarker).toHaveAttribute("data-raw-anchor", "start-20");
    expect(startMarker.closest('[role="listitem"]')).not.toBeNull();
    const endMarker = screen.getByText("▲ 第 1 章结束");
    expect(endMarker).toHaveAttribute("data-raw-anchor", "end-3520");
    expect(endMarker.closest('[role="listitem"]')).not.toBeNull();

    const scrollText = scrollArea().textContent ?? "";
    const startMarkerIndex = scrollText.indexOf("▼ 第 1 章");
    const chapterTextIndex = scrollText.indexOf("章章章");
    const endMarkerIndex = scrollText.indexOf("▲ 第 1 章结束");
    const suffixIndex = scrollText.indexOf("后后后");
    expect(startMarkerIndex).toBeGreaterThanOrEqual(0);
    expect(chapterTextIndex).toBeGreaterThan(startMarkerIndex);
    expect(endMarkerIndex).toBeGreaterThan(chapterTextIndex);
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

    const scrollText = scrollArea().textContent ?? "";
    const prefixIndex = scrollText.indexOf("前前前");
    const marker = screen.getByText("▼ 第 1 章「第一章 起点」开始 [20, 40)");
    expect(marker).toHaveAttribute("data-raw-anchor", "start-20");
    const markerIndex = scrollText.indexOf(marker.textContent ?? "");
    const chapterTextIndex = scrollText.indexOf("章章章");

    expect(prefixIndex).toBeGreaterThanOrEqual(0);
    expect(markerIndex).toBeGreaterThan(prefixIndex);
    expect(chapterTextIndex).toBeGreaterThan(markerIndex);
  });

  it("lists raw gaps, scrolls to them and creates chapters from them", () => {
    const onCreateFromGap = vi.fn();
    render(
      <ChapterRawPreview
        rawText={"字".repeat(400)}
        chapters={[
          {
            id: "chapter-gap-1",
            title: "甲章",
            charCount: 100,
            start: 100,
            end: 200,
            preview: "甲",
          },
          {
            id: "chapter-gap-2",
            title: "乙章",
            charCount: 50,
            start: 300,
            end: 350,
            preview: "乙",
          },
        ]}
        activeIndex={0}
        onCreateFromGap={onCreateFromGap}
      />,
    );

    const area = scrollArea();
    expect(screen.getByText("未切分 2 段")).toBeInTheDocument();
    // 空洞列表行点击 → 滚动到空洞起始处（空洞标签位于行内该段顶部）。
    const gapRows = screen.getAllByTitle("滚动到该段原文");
    expect(gapRows).toHaveLength(2);
    // 第二个空洞 [200, 300)：前面的空洞标签(22) + 100 字(88) + 章首标记(44) +
    // 章正文 100 字(88) + 章尾标记(28) = 270px 处是该空洞标签。
    const secondGapTop =
      gapLabelHeight("未切分 [0, 100) 100 字") +
      textHeight(100) +
      markerHeight("▼ 第 1 章「甲章」开始 [100, 200)") +
      textHeight(100) +
      markerHeight("▲ 第 1 章结束");
    fireEvent.click(gapRows[1]!);
    expect(area.scrollTop).toBe(secondGapTop - 8);

    // 从空洞创建章节：回调收到完整空洞文本与区间。
    const createButtons = screen.getAllByRole("button", { name: "+ 建章" });
    fireEvent.click(createButtons[0]!);
    expect(onCreateFromGap).toHaveBeenCalledTimes(1);
    expect(onCreateFromGap).toHaveBeenCalledWith("字".repeat(100), 0, 100);
  });

  it("follows the active chapter change", () => {
    const followChapters: CoverageChapter[] = [
      {
        id: "chapter-follow-1",
        title: "甲章",
        charCount: 100,
        start: 0,
        end: 100,
        preview: "甲",
      },
      {
        id: "chapter-follow-2",
        title: "乙章",
        charCount: 100,
        start: 100,
        end: 200,
        preview: "乙",
      },
    ];
    const { rerender } = render(
      <ChapterRawPreview
        rawText={"字".repeat(300)}
        chapters={followChapters}
        activeIndex={0}
      />,
    );
    const area = scrollArea();
    expect(area.scrollTop).toBe(0);

    rerender(
      <ChapterRawPreview
        rawText={"字".repeat(300)}
        chapters={followChapters}
        activeIndex={1}
      />,
    );
    // 第二章从 100 字正文（88px）之后开始。
    expect(area.scrollTop).toBe(textHeight(100) - 8);
  });
});

describe("collectRawGaps", () => {
  it("collects leading and inter-chapter gaps", () => {
    expect(
      collectRawGaps([
        {
          id: "a",
          title: "A",
          charCount: 1,
          start: 100,
          end: 200,
          preview: "",
        },
        {
          id: "b",
          title: "B",
          charCount: 1,
          start: 250,
          end: 300,
          preview: "",
        },
      ]),
    ).toEqual([
      { start: 0, end: 100, chars: 100 },
      { start: 200, end: 250, chars: 50 },
    ]);
  });
});
