import { Maximize2, PanelLeftOpen, Save, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../../components/ui";
import type { EditorMode, SeedIdentity } from "../../lib/types";
import { ChapterRail, ForumBusinessPanel } from "../forum/ForumPanels";

/** 普通创作展示层：统一完整、极简和移动布局，并封装移动目录抽屉。 */
export function StandardComposeWorkspace({
  mode,
  chapters,
  activeIndex,
  title,
  saveStatus,
  editor,
  identity,
  documentId,
  revision,
  saveDisabled,
  onSelectChapter,
  onSave,
  onRestore,
  onExpand,
}: {
  mode: EditorMode;
  chapters: readonly { id: string; title: string }[];
  activeIndex: number;
  title: string;
  saveStatus: ReactNode;
  editor: ReactNode;
  identity: SeedIdentity;
  documentId: string;
  revision: number;
  saveDisabled: boolean;
  onSelectChapter: (index: number) => void;
  onSave: () => void;
  onRestore: (revision: number) => void;
  onExpand: () => void;
}) {
  const [mobileChapterRailOpen, setMobileChapterRailOpen] = useState(false);

  // 离开移动模式时关闭抽屉，防止切回后残留遮罩和焦点状态。
  useEffect(() => {
    if (mode !== "mobile") setMobileChapterRailOpen(false);
  }, [mode]);

  if (mode === "full") {
    return (
      <div className="grid grid-cols-[220px_minmax(480px,1fr)_310px] items-start gap-3.5 max-[1180px]:grid-cols-[minmax(0,1fr)_300px] max-[1180px]:[&>*:first-child]:hidden max-[840px]:block max-[840px]:[&>aside]:hidden">
        <ChapterRail
          chapters={chapters}
          currentIndex={activeIndex}
          onSelect={onSelectChapter}
        />
        <section className="min-w-0">
          <div className="mb-2 flex min-h-[52px] items-center justify-between gap-3 rounded-lg border border-border bg-white py-2 pr-2.5 pl-3.5 shadow-panel max-[430px]:min-h-12 max-[430px]:pr-3 max-[430px]:pl-3">
            <div className="min-w-0">
              <p className="min-w-0 truncate text-[15px] font-bold">{title}</p>
              {saveStatus}
            </div>
            <Button size="sm" disabled={saveDisabled} onClick={onSave}>
              <Save size={14} />
              保存
            </Button>
          </div>
          {editor}
        </section>
        <ForumBusinessPanel
          identity={identity}
          documentId={documentId}
          baseRevision={revision}
          chapterId={chapters[activeIndex]?.id ?? ""}
          chapterTitle={chapters[activeIndex]?.title ?? title}
          onRestore={onRestore}
        />
      </div>
    );
  }

  return (
    <section className="relative">
      {mode === "mobile" ? (
        <>
          <Button
            variant="outline"
            size="icon"
            aria-label="打开章节目录"
            aria-expanded={mobileChapterRailOpen}
            className="fixed left-2 top-[76px] z-30 h-11 w-11 shadow-panel"
            onClick={() => setMobileChapterRailOpen(true)}
          >
            <PanelLeftOpen size={20} />
          </Button>
          {mobileChapterRailOpen ? (
            <div className="fixed inset-0 z-50" role="presentation">
              <button
                type="button"
                aria-label="关闭章节目录"
                className="absolute inset-0 bg-black/35"
                onClick={() => setMobileChapterRailOpen(false)}
              />
              <div
                className="absolute inset-y-0 left-0 w-[min(84vw,340px)] border-r border-border bg-white p-2 pt-[calc(12px+env(safe-area-inset-top))] shadow-2xl"
                role="dialog"
                aria-label="章节目录"
                aria-modal="true"
              >
                <div className="mb-2 flex items-center justify-between px-1">
                  <strong className="text-sm">章节目录</strong>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="关闭章节目录"
                    onClick={() => setMobileChapterRailOpen(false)}
                  >
                    <X size={18} />
                  </Button>
                </div>
                <ChapterRail
                  chapters={chapters}
                  currentIndex={activeIndex}
                  onSelect={(index) => {
                    onSelectChapter(index);
                    setMobileChapterRailOpen(false);
                  }}
                  className="static max-h-[calc(100vh-78px)] rounded-md shadow-none"
                />
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      <div className="mx-auto mb-2 flex max-w-[860px] items-center justify-between px-1">
        {saveStatus}
        {mode === "compact" ? (
          <Button variant="ghost" size="sm" onClick={onExpand}>
            <Maximize2 size={14} />
            展开
          </Button>
        ) : null}
      </div>
      {editor}
    </section>
  );
}
