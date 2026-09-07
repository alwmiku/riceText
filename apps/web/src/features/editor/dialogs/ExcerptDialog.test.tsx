import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExcerptDialog } from "./ExcerptDialog";
import { emptyExcerptValues, excerptParagraphs } from "./excerpt-values";

const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("ExcerptDialog", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 7, 12, 34));
  });
  afterEach(() => vi.useRealTimers());
  it("starts empty with Fanqie and requires both book and text", () => {
    const onInsert = vi.fn();
    render(<ExcerptDialog open onOpenChange={vi.fn()} onInsert={onInsert} />);
    for (const label of ["书名", "章节", "作者", "摘录正文"]) expect(screen.getByLabelText(label)).toHaveValue("");
    expect(screen.getByLabelText("排版")).toHaveValue("fanqie");
    expect(screen.getAllByRole("option")).toHaveLength(5);
    const submit = screen.getByRole("button", { name: "插入摘录" });
    change("摘录正文", "First\nSecond".replace("\n", String.fromCharCode(10)));
    expect(submit).toBeDisabled();
    change("书名", "   ");
    expect(submit).toBeDisabled();
    change("书名", " Book ");
    change("摘录正文", "   ");
    expect(submit).toBeDisabled();
    change("摘录正文", ["First", "Second"].join(String.fromCharCode(10)));
    expect(submit).toBeEnabled();
    const preview = within(screen.getByRole("region", { name: "摘录预览" }));
    expect(preview.getByText("First").tagName).toBe("P");
    expect(preview.getByText("Second").tagName).toBe("P");
    fireEvent.click(submit);
    expect(onInsert).toHaveBeenCalledWith({ ...emptyExcerptValues, readerTime: "12:34", bookTitle: "Book", text: ["First", "Second"].join(String.fromCharCode(10)) });
  });

  it("rejects non-HTTP URLs and updates the live preset preview", async () => {
    render(<ExcerptDialog open onOpenChange={vi.fn()} onInsert={vi.fn()} />);
    change("书名", "Book");
    change("摘录正文", "Text");
    const submit = screen.getByRole("button", { name: "插入摘录" });
    for (const url of ["javascript:alert(1)", "ftp://example.com", "not-a-url", "/chapter", "https://"]) {
      change("来源链接（可选）", url);
      expect(submit).toBeDisabled();
      expect(screen.getByLabelText("来源链接（可选）")).toHaveAttribute("aria-invalid", "true");
    }
    for (const url of ["http://example.com/chapter", " https://example.com/chapter ", ""]) {
      change("来源链接（可选）", url);
      expect(submit).toBeEnabled();
    }
    for (const variant of ["fanqie", "qidian", "desktop-book", "mobile-book", "forum-evidence"]) {
      change("排版", variant);
      await waitFor(() => expect(screen.getByRole("region", { name: "摘录预览" }).querySelector("[data-variant]")).toHaveAttribute("data-variant", variant));
    }
  });

  it("resets cancelled drafts and edits metadata with rich preview content", () => {
    const props = { onOpenChange: vi.fn(), onInsert: vi.fn() };
    const view = render(<ExcerptDialog open {...props} />);
    change("书名", "Unsaved");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(props.onInsert).not.toHaveBeenCalled();
    view.rerender(<ExcerptDialog open={false} {...props} />);
    view.rerender(<ExcerptDialog open {...props} />);
    expect(screen.getByLabelText("书名")).toHaveValue("");
    view.rerender(<ExcerptDialog open={false} {...props} />);
    view.rerender(<ExcerptDialog open {...props} initial={{ ...emptyExcerptValues, variant: "mobile-book" }} existingContent={[{ type: "paragraph", content: [{ type: "text", text: "Rich text", marks: [{ type: "bold" }] }] }]} />);
    expect(screen.queryByLabelText("摘录正文")).not.toBeInTheDocument();
    expect(screen.getByText("Rich text").closest("strong")).not.toBeNull();
    expect(screen.getByRole("button", { name: "保存修改" })).toBeEnabled();
    change("作者", "Author");
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    expect(props.onInsert).toHaveBeenCalledWith({ ...emptyExcerptValues, variant: "mobile-book", author: "Author" });
  });

  it("keeps a failed metadata save open", () => {
    const onOpenChange = vi.fn();
    render(<ExcerptDialog open initial={emptyExcerptValues} onOpenChange={onOpenChange} onInsert={() => false} />);
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    expect(screen.getByRole("alert")).toHaveTextContent("摘录已发生变化");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("hides automatic fields and changes only untouched battery defaults", () => {
    const onInsert = vi.fn();
    render(<ExcerptDialog open onOpenChange={vi.fn()} onInsert={onInsert} />);
    for (const label of ["时间", "页码", "阅读进度"]) expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    expect(screen.getByLabelText("电量（%）")).toHaveValue(100);
    change("排版", "qidian");
    expect(screen.getByLabelText("电量（%）")).toHaveValue(75);
    change("顶部信息", "起点热评");
    change("排版", "fanqie");
    expect(screen.getByLabelText("顶部信息")).toHaveValue("起点热评");
    expect(screen.getByLabelText("电量（%）")).toHaveValue(100);
    change("电量（%）", "42");
    change("排版", "qidian");
    expect(screen.getByLabelText("电量（%）")).toHaveValue(42);
    change("排版", "desktop-book");
    expect(screen.queryByLabelText("电量（%）")).not.toBeInTheDocument();
    change("书名", "Book");
    change("摘录正文", "Text");
    fireEvent.click(screen.getByRole("button", { name: "插入摘录" }));
    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ readerTime: "12:34", pageLabel: "1/1", progressLabel: "" }));
  });

  it("validates battery and submits reader metadata", () => {
    const onInsert = vi.fn();
    render(<ExcerptDialog open onOpenChange={vi.fn()} onInsert={onInsert} />);
    change("书名", "Book");
    change("摘录正文", "Text");
    const submit = screen.getByRole("button", { name: "插入摘录" });
    for (const invalid of ["", "-1", "101", "1.5"]) {
      change("电量（%）", invalid);
      expect(submit).toBeDisabled();
      expect(screen.getByLabelText("电量（%）")).toHaveAttribute("aria-invalid", "true");
    }
    change("电量（%）", "0");
    change("顶部信息", "00:24得991金币");
    fireEvent.click(submit);
    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ readerTime: "12:34", batteryLevel: "0", pageLabel: "1/1", progressLabel: "", headerLabel: "00:24得991金币" }));
  });

  it("keeps the preview timestamp stable and captures actual insertion time", async () => {
    const onInsert = vi.fn();
    render(<ExcerptDialog open onOpenChange={vi.fn()} onInsert={onInsert} />);
    const preview = screen.getByRole("region", { name: "摘录预览" });
    await waitFor(() => expect(preview.querySelector("[data-reader-time]")).toHaveAttribute("data-reader-time", "12:34"));
    vi.setSystemTime(new Date(2026, 8, 7, 13, 7));
    change("书名", "Book");
    change("摘录正文", "Text");
    change("排版", "qidian");
    await waitFor(() => expect(preview.querySelector("[data-reader-time]")).toHaveAttribute("data-reader-time", "12:34"));
    fireEvent.click(screen.getByRole("button", { name: "插入摘录" }));
    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ readerTime: "13:07", pageLabel: "1/1", progressLabel: "" }));
  });

  it("takes a fresh local timestamp each time a new form is opened", async () => {
    const props = { onOpenChange: vi.fn(), onInsert: vi.fn() };
    const view = render(<ExcerptDialog open {...props} />);
    await waitFor(() => expect(screen.getByRole("region", { name: "摘录预览" }).querySelector("[data-reader-time]")).toHaveAttribute("data-reader-time", "12:34"));
    view.rerender(<ExcerptDialog open={false} {...props} />);
    vi.setSystemTime(new Date(2026, 8, 7, 14, 56));
    view.rerender(<ExcerptDialog open {...props} />);
    await waitFor(() => expect(screen.getByRole("region", { name: "摘录预览" }).querySelector("[data-reader-time]")).toHaveAttribute("data-reader-time", "14:56"));
  });

  it("preserves hidden stored clock and legacy page metadata while editing", async () => {
    const onInsert = vi.fn();
    const initial = { ...emptyExcerptValues, bookTitle: "Old", readerTime: "22:05", pageLabel: "88/100", progressLabel: "88%" };
    const content = [{ type: "paragraph", content: [{ type: "text", text: "Stored text" }] }];
    const view = render(<ExcerptDialog open initial={initial} existingContent={content} onOpenChange={vi.fn()} onInsert={onInsert} />);
    vi.setSystemTime(new Date(2026, 8, 8, 9, 10));
    for (const label of ["时间", "页码", "阅读进度"]) expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    change("排版", "qidian");
    change("书名", "Renamed");
    await waitFor(() => expect(screen.getByRole("region", { name: "摘录预览" }).querySelector("[data-reader-time]")).toHaveAttribute("data-reader-time", "22:05"));
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ readerTime: "22:05", pageLabel: "88/100", progressLabel: "88%" }));
    view.rerender(<ExcerptDialog open={false} onOpenChange={vi.fn()} onInsert={onInsert} />);
    view.rerender(<ExcerptDialog open initial={onInsert.mock.calls[0]![0]} existingContent={content} onOpenChange={vi.fn()} onInsert={onInsert} />);
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    expect(onInsert.mock.calls[1]![0].readerTime).toBe("22:05");
  });

  it("normalizes newlines, skips blank lines and preserves text indentation", () => {
    expect(excerptParagraphs("  first" + String.fromCharCode(13, 10, 13) + "second" + String.fromCharCode(10))).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "  first" }] },
      { type: "paragraph", content: [{ type: "text", text: "second" }] },
    ]);
  });
});
