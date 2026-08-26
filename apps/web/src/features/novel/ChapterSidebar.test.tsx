import { MAX_CHAPTER_LENGTH } from "@ricetext/editor-core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChapterSidebar, type ChapterSummary } from "./ChapterSidebar";

const chapters: ChapterSummary[] = [
  { id: "chapter-0", title: "楔子", charCount: 100 },
  { id: "chapter-1", title: "第一章", charCount: 200 },
  { id: "chapter-2", title: "第二章", charCount: MAX_CHAPTER_LENGTH },
];

function renderSidebar(overrides: Partial<Parameters<typeof ChapterSidebar>[0]> = {}) {
  const props = {
    chapters,
    activeIndex: 1,
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onMerge: vi.fn(),
    onMove: vi.fn(),
    ...overrides,
  };
  return { ...render(<ChapterSidebar {...props} />), props };
}

describe("ChapterSidebar", () => {
  it("支持点击和键盘切换章节，并展示空目录", () => {
    const { props, rerender } = renderSidebar();
    const first = screen.getByText("楔子").closest('[role="button"]') as HTMLElement;
    const second = screen.getByText("第一章").closest('[role="button"]') as HTMLElement;

    fireEvent.click(second);
    fireEvent.keyDown(first, { key: "Enter" });
    fireEvent.keyDown(first, { key: " " });
    fireEvent.keyDown(first, { key: "Escape" });
    expect(props.onSelect).toHaveBeenNthCalledWith(1, 1);
    expect(props.onSelect).toHaveBeenNthCalledWith(2, 0);
    expect(props.onSelect).toHaveBeenNthCalledWith(3, 0);

    rerender(<ChapterSidebar {...props} chapters={[]} activeIndex={0} />);
    expect(screen.getByText("暂无章节")).toBeInTheDocument();
  });

  it("转发上移、下移、合并和删除操作并阻止冒泡选章", () => {
    const { props } = renderSidebar();
    const first = screen.getByText("楔子").closest('[role="button"]') as HTMLElement;
    const second = screen.getByText("第一章").closest('[role="button"]') as HTMLElement;
    const third = screen.getByText("第二章").closest('[role="button"]') as HTMLElement;

    expect(within(first).getByRole("button", { name: "上移" })).toBeDisabled();
    fireEvent.click(within(first).getByRole("button", { name: "下移" }));
    fireEvent.click(within(second).getByRole("button", { name: "上移" }));
    fireEvent.click(within(second).getByRole("button", { name: "合并到上一章" }));
    fireEvent.click(within(third).getByRole("button", { name: "删除章节" }));

    expect(props.onMove).toHaveBeenNthCalledWith(1, 0, 1);
    expect(props.onMove).toHaveBeenNthCalledWith(2, 1, 0);
    expect(props.onMerge).toHaveBeenCalledWith(1);
    expect(props.onDelete).toHaveBeenCalledWith(2);
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(
      within(third).getByRole("button", { name: "合并到上一章" }),
    ).toBeDisabled();
  });

  it("通过拖放移动章节，并忽略拖回原位置", () => {
    const { props } = renderSidebar();
    const first = screen.getByText("楔子").closest('[role="button"]') as HTMLElement;
    const second = screen.getByText("第一章").closest('[role="button"]') as HTMLElement;
    const dataTransfer = {
      effectAllowed: "none",
      setData: vi.fn(),
      getData: vi.fn(() => "0"),
    };

    fireEvent.dragStart(first, { dataTransfer });
    expect(dataTransfer.effectAllowed).toBe("move");
    expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "0");
    fireEvent.dragOver(second, { dataTransfer });
    fireEvent.drop(second, { dataTransfer });
    expect(props.onMove).toHaveBeenCalledWith(0, 1);

    fireEvent.dragStart(first, { dataTransfer });
    fireEvent.drop(first, { dataTransfer });
    fireEvent.dragEnd(first);
    expect(props.onMove).toHaveBeenCalledTimes(1);
  });
});
