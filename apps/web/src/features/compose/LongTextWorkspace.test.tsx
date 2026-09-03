import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { LongTextWorkspace } from "./LongTextWorkspace";

vi.mock("../novel/ChapterSidebar", () => ({
  ChapterSidebar: (props: {
    onSelect: (index: number) => void;
    onDelete: (index: number) => void;
    onMerge: (index: number) => void;
    onMove: (from: number, to: number) => void;
  }) => (
    <div>
      <button onClick={() => props.onSelect(1)}>模拟选择章节</button>
      <button onClick={() => props.onDelete(1)}>模拟删除章节</button>
      <button onClick={() => props.onMerge(1)}>模拟合并章节</button>
      <button onClick={() => props.onMove(1, 0)}>模拟移动章节</button>
    </div>
  ),
}));

vi.mock("../novel/ChapterRawPreview", () => ({
  ChapterRawPreview: (props: {
    onCreateFromGap: (text: string, start: number, end: number) => void;
  }) => (
    <button onClick={() => props.onCreateFromGap("缺失正文", 10, 14)}>
      模拟创建缺口章节
    </button>
  ),
}));

vi.mock("../novel/ChapterCoverageDialog", () => ({
  ChapterCoverageDialog: (props: { onClose: () => void }) => (
    <div>
      模拟全文对比
      <button onClick={props.onClose}>关闭模拟全文对比</button>
    </div>
  ),
}));

vi.mock("../novel/AddChapterDialog", () => ({
  AddChapterDialog: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (title: string, text: string) => boolean;
  }) =>
    props.open ? (
      <div>
        模拟添加章节弹窗
        <button onClick={() => props.onSubmit("番外", "正文")}>模拟提交章节</button>
        <button onClick={() => props.onOpenChange(false)}>关闭模拟添加章节</button>
      </div>
    ) : null,
}));

vi.mock("../novel/ChapterUploadDialog", () => ({
  ChapterUploadDialog: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
  }) =>
    props.open ? (
      <div>
        模拟上传弹窗
        <button onClick={props.onConfirm}>模拟确认上传</button>
        <button onClick={() => props.onOpenChange(false)}>模拟取消上传</button>
      </div>
    ) : null,
}));

function createProps() {
  return {
    saveStatus: <span>已保存</span> as ReactNode,
    chapters: [{ id: "chapter-0", title: "第一章", charCount: 4 }],
    coverageChapters: [
      {
        id: "chapter-0",
        title: "第一章",
        charCount: 4,
        start: 0,
        end: 4,
        preview: "正文",
      },
    ],
    activeIndex: 0,
    rawText: "正文",
    editor: <div>编辑器</div> as ReactNode,
    chapterTitleStyle: "auto" as const,
    hasLocalDraft: true,
    hasStoredDraft: true,
    isPlaceholderData: false,
    uploadOpen: true,
    uploadDiff: {
      total: 1,
      toUpdate: 1,
      added: 1,
      modified: 0,
      uploaded: 0,
      failed: 0,
      pending: 1,
      gaps: 0,
      batchCurrent: null,
      batchTotal: null,
      rows: [
        {
          id: "chapter-0",
          title: "第一章",
          action: "新增" as const,
          status: "待上传" as const,
          attempts: 0,
        },
      ],
    },
    preparingUpload: false,
    uploading: false,
    hasUploadCheckpoint: false,
    onChapterTitleStyleChange: vi.fn(),
    onImportFile: vi.fn().mockResolvedValue(undefined),
    onRestoreDraft: vi.fn().mockResolvedValue(undefined),
    onClearDraft: vi.fn().mockResolvedValue(true),
    onPrepareUpload: vi.fn().mockResolvedValue(undefined),
    onResumeUpload: vi.fn(),
    onCancelUpload: vi.fn(),
    onConfirmUpload: vi.fn().mockResolvedValue(undefined),
    onExit: vi.fn(),
    onAddChapter: vi.fn(() => true),
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onMerge: vi.fn(),
    onMove: vi.fn(),
    onCreateFromGap: vi.fn(),
  };
}

describe("LongTextWorkspace", () => {
  it("转发章节、导入、草稿、上传和弹窗操作", () => {
    const props = createProps();
    render(<LongTextWorkspace {...props} />);

    fireEvent.change(screen.getByLabelText("章节标题风格"), {
      target: { value: "english" },
    });
    expect(props.onChapterTitleStyleChange).toHaveBeenCalledWith("english");

    const file = new File(["第一章\n正文"], "novel.txt", {
      type: "text/plain",
    });
    fireEvent.change(screen.getByLabelText("导入长文本文件"), {
      target: { files: [file] },
    });
    expect(props.onImportFile).toHaveBeenCalledWith(file);

    fireEvent.click(screen.getByRole("button", { name: "恢复本机草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "清除本机草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "确定并上传" }));
    fireEvent.click(screen.getByRole("button", { name: "退出长文本" }));
    expect(props.onRestoreDraft).toHaveBeenCalledOnce();
    expect(props.onClearDraft).toHaveBeenCalledOnce();
    expect(props.onPrepareUpload).toHaveBeenCalledOnce();
    expect(props.onExit).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "模拟选择章节" }));
    fireEvent.click(screen.getByRole("button", { name: "模拟删除章节" }));
    fireEvent.click(screen.getByRole("button", { name: "模拟合并章节" }));
    fireEvent.click(screen.getByRole("button", { name: "模拟移动章节" }));
    fireEvent.click(screen.getByRole("button", { name: "模拟创建缺口章节" }));
    expect(props.onSelect).toHaveBeenCalledWith(1);
    expect(props.onDelete).toHaveBeenCalledWith(1);
    expect(props.onMerge).toHaveBeenCalledWith(1);
    expect(props.onMove).toHaveBeenCalledWith(1, 0);
    expect(props.onCreateFromGap).toHaveBeenCalledWith("缺失正文", 10, 14);

    fireEvent.click(screen.getByRole("button", { name: "全文对比" }));
    expect(screen.getByText("模拟全文对比")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭模拟全文对比" }));

    fireEvent.click(screen.getByRole("button", { name: "添加章节" }));
    fireEvent.click(screen.getByRole("button", { name: "模拟提交章节" }));
    expect(props.onAddChapter).toHaveBeenCalledWith("番外", "正文");
    fireEvent.click(screen.getByRole("button", { name: "关闭模拟添加章节" }));

    fireEvent.click(screen.getByRole("button", { name: "模拟确认上传" }));
    fireEvent.click(screen.getByRole("button", { name: "模拟取消上传" }));
    expect(props.onConfirmUpload).toHaveBeenCalledOnce();
    expect(props.onCancelUpload).toHaveBeenCalledOnce();
  });

  it("展示准备和上传状态并隐藏本地草稿入口", () => {
    const props = {
      ...createProps(),
      hasLocalDraft: false,
      uploadOpen: false,
      preparingUpload: true,
    };
    const { rerender } = render(<LongTextWorkspace {...props} />);
    expect(screen.getByRole("button", { name: "计算差异…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "恢复本机草稿" })).not.toBeInTheDocument();

    rerender(
      <LongTextWorkspace
        {...props}
        preparingUpload={false}
        uploading
      />,
    );
    expect(screen.getByRole("button", { name: "上传中…" })).toBeDisabled();
  });
});
