import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AddChapterDialog } from "./AddChapterDialog";
import {
  analyzeCoverage,
  ChapterCoverageDialog,
  type CoverageChapter,
} from "./ChapterCoverageDialog";
import { ChapterUploadDialog, type ChapterUploadDiff } from "./ChapterUploadDialog";

const coverageChapters: CoverageChapter[] = [
  { id: "start", title: "第一章", charCount: 10, start: 2, end: 12, preview: "开头" },
  { id: "gap", title: "第二章", charCount: 5, start: 15, end: 20, preview: "" },
  { id: "overlap", title: "第三章", charCount: 8, start: 18, end: 26, preview: "重叠" },
  { id: "manual", title: "番外", charCount: 4, start: null, end: null, preview: "手写" },
  { id: "after-manual", title: "第四章", charCount: 4, start: 26, end: 30, preview: "接续" },
];

const uploadDiff: ChapterUploadDiff = {
  total: 3,
  toUpdate: 2,
  added: 1,
  modified: 1,
  uploaded: 0,
  gaps: 2,
  stale: false,
  rows: [
    { id: "one", title: "第一章", action: "新增", status: "待上传", attempts: 0 },
    { id: "two", title: "第二章", action: "修改", status: "待上传", attempts: 0 },
    { id: "three", title: "第三章", action: "未变化", status: "未变化", attempts: 0 },
  ],
};

describe("AddChapterDialog", () => {
  it("保留失败提交，成功后关闭，并在重新打开时清空草稿", () => {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { rerender } = render(
      <AddChapterDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />,
    );

    fireEvent.change(screen.getByLabelText("章节标题"), {
      target: { value: "番外" },
    });
    fireEvent.change(screen.getByLabelText(/正文/), {
      target: { value: "雨季来信" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加并编辑" }));
    expect(onSubmit).toHaveBeenLastCalledWith("番外", "雨季来信");
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "添加并编辑" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    rerender(
      <AddChapterDialog open={false} onOpenChange={onOpenChange} onSubmit={onSubmit} />,
    );
    rerender(
      <AddChapterDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />,
    );
    expect(screen.getByLabelText("章节标题")).toHaveValue("");
    expect(screen.getByLabelText(/正文/)).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});

describe("ChapterUploadDialog", () => {
  it("展示上传差异、缺口和各状态并转发确认与取消", () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ChapterUploadDialog
        open
        diff={uploadDiff}
        uploading={false}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
        onReprepare={vi.fn()}
      />,
    );

    expect(screen.getByText(/仍有/)).toHaveTextContent("2");
    expect(screen.getByText(/本地共/)).toHaveTextContent("本次上传 2 个");
    expect(screen.getByText("总上传进度")).toBeInTheDocument();
    expect(screen.getByLabelText("长文本上传总进度")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认分章上传" }));
    fireEvent.click(screen.getByRole("button", { name: "稍后继续" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("覆盖无缺口、上传中和空差异分支", () => {
    const { rerender } = render(
      <ChapterUploadDialog
        open
        diff={{ ...uploadDiff, gaps: 0 }}
        uploading
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        onReprepare={vi.fn()}
      />,
    );
    expect(screen.getByText(/全部原文已连续切分/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "稍后继续" })).toBeDisabled();

    rerender(
      <ChapterUploadDialog
        open
        diff={null}
        uploading={false}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        onReprepare={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "确认分章上传" })).not.toBeInTheDocument();
  });
});

describe("ChapterCoverageDialog", () => {
  it("分析开头缺口、章节缺口、重叠、手动章节和接续分支", () => {
    expect(analyzeCoverage(coverageChapters)).toEqual({
      totalChars: 30,
      continuous: false,
      checks: [
        { index: 0, status: "gap", gapChars: 2 },
        { index: 1, status: "gap", gapChars: 3 },
        { index: 2, status: "overlap", gapChars: 2 },
        { index: 3, status: "manual", gapChars: 0 },
        { index: 4, status: "ok", gapChars: 0 },
      ],
    });
    expect(
      analyzeCoverage([
        { ...coverageChapters[0]!, start: 0 },
        { ...coverageChapters[1]!, start: 12 },
      ]),
    ).toMatchObject({
      continuous: true,
      checks: [
        { status: "start", gapChars: 0 },
        { status: "ok", gapChars: 0 },
      ],
    });
  });

  it("展示状态、展开空预览、收起并关闭", () => {
    const onClose = vi.fn();
    render(<ChapterCoverageDialog chapters={coverageChapters} onClose={onClose} />);
    expect(screen.getByText(/存在缺失或重叠/)).toBeInTheDocument();
    expect(screen.getByText("有缺失（缺失 3 字）")).toBeInTheDocument();
    expect(screen.getByText("有重叠（重叠 2 字）")).toBeInTheDocument();
    expect(screen.getByText("手动添加")).toBeInTheDocument();

    fireEvent.click(screen.getByText("第二章"));
    expect(screen.getByText("（空）")).toBeInTheDocument();
    fireEvent.click(screen.getByText("第二章"));
    expect(screen.queryByText("（空）")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
