import type { ReactNode } from "react";
import { ChapterRawPreview } from "../novel/ChapterRawPreview";
import { ChapterSidebar, type ChapterSummary } from "../novel/ChapterSidebar";
import type { CoverageChapter } from "../novel/ChapterCoverageDialog";

export function LongTextWorkspace({
  saveStatus,
  controls,
  chapters,
  coverageChapters,
  activeIndex,
  rawText,
  editor,
  onSelect,
  onDelete,
  onMerge,
  onMove,
  onCreateFromGap,
}: {
  saveStatus: ReactNode;
  controls: ReactNode;
  chapters: readonly ChapterSummary[];
  coverageChapters: readonly CoverageChapter[];
  activeIndex: number;
  rawText: string | null;
  editor: ReactNode;
  onSelect: (index: number) => void;
  onDelete: (index: number) => void;
  onMerge: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onCreateFromGap: (text: string, start: number, end: number) => void;
}) {
  return (
    <section className="mx-auto max-w-[1680px]">
      <div className="mb-2 flex min-h-[52px] items-center justify-between gap-3 rounded-lg border border-border bg-white py-2 pr-2.5 pl-3.5 shadow-panel max-[430px]:min-h-12 max-[430px]:pr-3 max-[430px]:pl-3">
        <div className="min-w-0">
          <p className="min-w-0 truncate text-[15px] font-bold">长文本工作台</p>
          {saveStatus}
        </div>
        <div className="flex items-center gap-2">{controls}</div>
      </div>
      <div className="grid grid-cols-[340px_minmax(420px,1fr)_minmax(0,1.6fr)] items-start gap-3 p-3">
        <ChapterSidebar
          chapters={chapters}
          activeIndex={activeIndex}
          onSelect={onSelect}
          onDelete={onDelete}
          onMerge={onMerge}
          onMove={onMove}
        />
        <ChapterRawPreview
          rawText={rawText}
          chapters={coverageChapters}
          activeIndex={activeIndex}
          onCreateFromGap={onCreateFromGap}
        />
        <div className="min-w-0">{editor}</div>
      </div>
    </section>
  );
}
