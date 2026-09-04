import type { ChapterTitleStyle } from "@ricetext/editor-core";
import { FileUp, Save, Trash2 } from "lucide-react";
import { memo, useRef, useState, type ReactNode } from "react";
import { Button } from "../../components/ui";
import { ChapterRawPreview } from "../novel/ChapterRawPreview";
import { ChapterSidebar, type ChapterSummary } from "../novel/ChapterSidebar";
import {
  ChapterCoverageDialog,
  type CoverageChapter,
} from "../novel/ChapterCoverageDialog";
import {
  ChapterUploadDialog,
  type ChapterUploadDiff,
} from "../novel/ChapterUploadDialog";
import { AddChapterDialog } from "../novel/AddChapterDialog";

const chapterStyleOptions: Array<{
  value: ChapterTitleStyle;
  label: string;
}> = [
  { value: "auto", label: "自动识别" },
  { value: "chinese", label: "中文：第 X 章" },
  { value: "english", label: "English: Chapter X" },
  { value: "numeric", label: "数字：1. 标题" },
];

// 上传进度按批发布时会触发整棵 LongTextWorkspace 的重渲染；两侧大列表
// 的 props 在上传期间保持稳定，用 memo 跳过重绘，避免几千章时每批都
// 重新 reconcile 数千行 DOM（这正是触发浏览器“页面无响应”的原因）。
const MemoChapterSidebar = memo(ChapterSidebar);
const MemoChapterRawPreview = memo(ChapterRawPreview);

/** 长文本展示层：负责工具栏、三栏布局及其附属弹窗，不读写业务存储。 */
export function LongTextWorkspace({
  saveStatus,
  chapters,
  coverageChapters,
  activeIndex,
  rawText,
  editor,
  chapterTitleStyle,
  hasLocalDraft,
  hasStoredDraft,
  isPlaceholderData,
  uploadOpen,
  uploadDiff,
  preparingUpload,
  uploading,
  hasUploadCheckpoint,
  onChapterTitleStyleChange,
  onImportFile,
  onRestoreDraft,
  onClearDraft,
  onPrepareUpload,
  onResumeUpload,
  onCancelUpload,
  onConfirmUpload,
  onExit,
  onAddChapter,
  onSelect,
  onDelete,
  onMerge,
  onMove,
  onCreateFromGap,
}: {
  saveStatus: ReactNode;
  chapters: readonly ChapterSummary[];
  coverageChapters: readonly CoverageChapter[];
  activeIndex: number;
  rawText: string | null;
  editor: ReactNode;
  chapterTitleStyle: ChapterTitleStyle;
  hasLocalDraft: boolean;
  hasStoredDraft: boolean;
  isPlaceholderData: boolean;
  uploadOpen: boolean;
  uploadDiff: ChapterUploadDiff | null;
  preparingUpload: boolean;
  uploading: boolean;
  hasUploadCheckpoint: boolean;
  onChapterTitleStyleChange: (style: ChapterTitleStyle) => void;
  onImportFile: (file: File) => Promise<void>;
  onRestoreDraft: () => Promise<void>;
  onClearDraft: () => Promise<boolean>;
  onPrepareUpload: () => Promise<void>;
  onResumeUpload: () => void;
  onCancelUpload: () => void;
  onConfirmUpload: () => Promise<void>;
  onExit: () => boolean | Promise<boolean>;
  onAddChapter: (title: string, text: string) => boolean | Promise<boolean>;
  onSelect: (index: number) => void;
  onDelete: (index: number) => void;
  onMerge: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onCreateFromGap: (
    text: string,
    start: number,
    end: number,
  ) => void | Promise<void>;
}) {
  // 文件选择器、弹窗开关属于展示层瞬时状态，不进入长文本领域 Hook。
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [addChapterOpen, setAddChapterOpen] = useState(false);

  return (
    <>
      <section className="mx-auto max-w-[1680px]">
        <div className="mb-2 flex min-h-[52px] items-center justify-between gap-3 rounded-lg border border-border bg-white py-2 pr-2.5 pl-3.5 shadow-panel max-[430px]:min-h-12 max-[430px]:pr-3 max-[430px]:pl-3">
          <div className="min-w-0">
            <p className="min-w-0 truncate text-[15px] font-bold">
              长文本工作台
            </p>
            {saveStatus}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="text/plain,.txt"
              className="sr-only"
              aria-label="导入长文本文件"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void onImportFile(file);
              }}
            />
            <label className="sr-only" htmlFor="long-text-heading-style">
              章节标题风格
            </label>
            <select
              id="long-text-heading-style"
              className="h-8 border bg-background px-2 text-xs"
              value={chapterTitleStyle}
              onChange={(event) =>
                onChapterTitleStyleChange(
                  event.target.value as ChapterTitleStyle,
                )
              }
              aria-label="章节标题风格"
            >
              {chapterStyleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={isPlaceholderData}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp size={14} />
              导入 .txt
            </Button>
            {hasLocalDraft ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void onRestoreDraft()}
              >
                恢复本机草稿
              </Button>
            ) : null}
            {hasStoredDraft ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={uploading}
                onClick={() => void onClearDraft()}
              >
                <Trash2 data-icon="inline-start" />
                清除本机草稿
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCoverageOpen(true)}
            >
              全文对比
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddChapterOpen(true)}
            >
              添加章节
            </Button>
            <Button
              size="sm"
              disabled={preparingUpload || uploading}
              onClick={() => {
                if (hasUploadCheckpoint) onResumeUpload();
                else void onPrepareUpload();
              }}
            >
              <Save data-icon="inline-start" />
              {preparingUpload
                ? "计算差异…"
                : uploading
                  ? "上传中…"
                  : hasUploadCheckpoint
                    ? "继续上传"
                    : "确定并上传"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void onExit()}>
              退出长文本
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-[340px_minmax(420px,1fr)_minmax(0,1.6fr)] items-start gap-3 p-3 max-[900px]:grid-cols-1">
          <MemoChapterSidebar
            chapters={chapters}
            activeIndex={activeIndex}
            onSelect={onSelect}
            onDelete={onDelete}
            onMerge={onMerge}
            onMove={onMove}
          />
          <MemoChapterRawPreview
            rawText={rawText}
            chapters={coverageChapters}
            activeIndex={activeIndex}
            onCreateFromGap={onCreateFromGap}
          />
          <div className="min-w-0">{editor}</div>
        </div>
      </section>
      {coverageOpen ? (
        <ChapterCoverageDialog
          chapters={coverageChapters}
          onClose={() => setCoverageOpen(false)}
        />
      ) : null}
      <AddChapterDialog
        open={addChapterOpen}
        onOpenChange={setAddChapterOpen}
        onSubmit={onAddChapter}
      />
      <ChapterUploadDialog
        open={uploadOpen}
        diff={uploadDiff}
        uploading={uploading}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onCancelUpload();
        }}
        onConfirm={() => void onConfirmUpload()}
        onReprepare={() => void onPrepareUpload()}
      />
    </>
  );
}
