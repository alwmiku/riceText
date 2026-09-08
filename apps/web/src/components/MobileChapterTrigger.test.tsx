import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileChapterTrigger } from "./MobileChapterTrigger";

const viewportWidth = window.innerWidth;
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 390 });
  Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 100 });
});
afterEach(() => {
  vi.useRealTimers();
  window.innerWidth = viewportWidth;
  window.scrollY = 0;
  vi.restoreAllMocks();
});
function scroll(y: number) { window.scrollY = y; fireEvent.scroll(window); }

describe("MobileChapterTrigger", () => {
  it("文字上移时收边、下移时展开，并累计细小滚动", () => {
    render(<MobileChapterTrigger open={false} onOpen={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "打开章节目录" });
    expect(trigger).toHaveAttribute("data-revealed", "false");
    scroll(160);
    expect(trigger).toHaveAttribute("data-revealed", "false");
    scroll(156);
    expect(trigger).toHaveAttribute("data-revealed", "false");
    scroll(152);
    expect(trigger).toHaveAttribute("data-revealed", "true");
    scroll(200);
    expect(trigger).toHaveAttribute("data-revealed", "false");
    scroll(180);
    expect(trigger).toHaveAttribute("data-revealed", "true");
    act(() => vi.advanceTimersByTime(1800));
    expect(trigger).toHaveAttribute("data-revealed", "false");
  });
  it("点击边缘入口即可打开，抽屉打开时不会随滚动收起", () => {
    const onOpen = vi.fn();
    const view = render(<MobileChapterTrigger open={false} onOpen={onOpen} />);
    const trigger = screen.getByRole("button", { name: "打开章节目录" });
    fireEvent.click(trigger);
    expect(onOpen).toHaveBeenCalledOnce();
    view.rerender(<MobileChapterTrigger open onOpen={onOpen} />);
    scroll(300);
    act(() => vi.advanceTimersByTime(2000));
    expect(trigger).toHaveAttribute("data-revealed", "true");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
  it("阅读选区激活时保持入口可见，清除选区后恢复自动收边", () => {
    render(<><div className="rt-viewer">正文</div><MobileChapterTrigger open={false} onOpen={vi.fn()} /></>);
    const anchor = screen.getByText("正文").firstChild;
    const selection = vi.spyOn(window, "getSelection").mockReturnValue({ anchorNode: anchor, isCollapsed: false } as Selection);
    fireEvent(document, new Event("selectionchange"));
    const trigger = screen.getByRole("button", { name: "打开章节目录" });
    scroll(300);
    act(() => vi.advanceTimersByTime(2000));
    expect(trigger).toHaveAttribute("data-revealed", "true");
    selection.mockReturnValue({ anchorNode: anchor, isCollapsed: true } as Selection);
    fireEvent(document, new Event("selectionchange"));
    act(() => vi.advanceTimersByTime(1800));
    expect(trigger).toHaveAttribute("data-revealed", "false");
  });
  it("不会因页面顶部的回弹误展开，卸载后移除入口", () => {
    window.scrollY = 0;
    const view = render(<MobileChapterTrigger open={false} onOpen={vi.fn()} />);
    scroll(-25);
    expect(screen.getByRole("button", { name: "打开章节目录" })).toHaveAttribute("data-revealed", "false");
    view.unmount();
    scroll(100);
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByRole("button", { name: "打开章节目录" })).not.toBeInTheDocument();
  });
});
