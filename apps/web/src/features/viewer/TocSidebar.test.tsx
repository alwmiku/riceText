import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TocSidebar } from "./TocSidebar";

const chapters = [
  { id: "chapter-0", title: "第一章 · 潮汐表" },
  { id: "chapter-1", title: "第二章 · 船票" },
];

describe("TocSidebar", () => {
  it("移动端目录抽屉切换章节后自动关闭", () => {
    const onSelect = vi.fn();
    render(
      <TocSidebar chapters={chapters} currentIndex={0} onSelect={onSelect} />,
    );

    const trigger = screen.getByRole("button", { name: "打开阅读目录" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(
      screen.getByRole("dialog", { name: "阅读章节目录" }),
    ).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const secondChapter = within(
      screen.getByRole("dialog", { name: "阅读章节目录" }),
    ).getByRole("button", { name: /第二章/ });
    fireEvent.click(secondChapter);
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(
      screen.queryByRole("dialog", { name: "阅读章节目录" }),
    ).not.toBeInTheDocument();
  });

  it("没有章节时不渲染目录入口", () => {
    render(<TocSidebar chapters={[]} currentIndex={0} onSelect={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: "打开阅读目录" }),
    ).not.toBeInTheDocument();
  });
});
