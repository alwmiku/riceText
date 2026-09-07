import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExcerptDialog } from "./ExcerptDialog";
import { emptyExcerptValues, excerptParagraphs } from "./excerpt-values";

const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("ExcerptDialog", () => {
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
    expect(onInsert).toHaveBeenCalledWith({ ...emptyExcerptValues, bookTitle: "Book", text: ["First", "Second"].join(String.fromCharCode(10)) });
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

  it("shows reader fields only for platforms and changes only untouched defaults", () => {
    render(<ExcerptDialog open onOpenChange={vi.fn()} onInsert={vi.fn()} />);
    expect(screen.getByLabelText("时间")).toHaveValue("13:59");
    expect(screen.getByLabelText("电量（%）")).toHaveValue(100);
    change("排版", "qidian");
    expect(screen.getByLabelText("时间")).toHaveValue("10:18");
    expect(screen.getByLabelText("页码")).toHaveValue("2/20");
    expect(screen.getByLabelText("阅读进度")).toHaveValue("1.0%");
    expect(screen.getByLabelText("电量（%）")).toHaveValue(75);
    change("时间", "09:41");
    change("页码", "42/100");
    change("顶部信息", "起点热评");
    change("排版", "fanqie");
    expect(screen.getByLabelText("时间")).toHaveValue("09:41");
    expect(screen.getByLabelText("页码")).toHaveValue("42/100");
    expect(screen.getByLabelText("顶部信息")).toHaveValue("起点热评");
    expect(screen.getByLabelText("电量（%）")).toHaveValue(100);
    change("排版", "desktop-book");
    expect(screen.queryByLabelText("时间")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("电量（%）")).not.toBeInTheDocument();
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
    change("时间", "22:05");
    change("页码", "88/100");
    change("阅读进度", "88%");
    change("顶部信息", "00:24得991金币");
    fireEvent.click(submit);
    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ readerTime: "22:05", batteryLevel: "0", pageLabel: "88/100", progressLabel: "88%", headerLabel: "00:24得991金币" }));
  });

  it("normalizes newlines, skips blank lines and preserves text indentation", () => {
    expect(excerptParagraphs("  first" + String.fromCharCode(13, 10, 13) + "second" + String.fromCharCode(10))).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "  first" }] },
      { type: "paragraph", content: [{ type: "text", text: "second" }] },
    ]);
  });
});
