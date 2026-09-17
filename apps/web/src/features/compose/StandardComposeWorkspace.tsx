import { Maximize2, RefreshCw, Save, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../../components/ui";
import { MobileChapterTrigger } from "../../components/MobileChapterTrigger";
import {
  CHAPTER_EDITOR_CAPABILITIES,
  chapterUnitCan,
  type ChapterEditingUnit,
} from "../../lib/chapter-editing-unit";
import type { EditorMode, SeedIdentity } from "../../lib/types";
import { ChapterRail, ForumBusinessPanel } from "../forum/ForumPanels";

/** 普通创作展示层：统一完整、极简和移动布局，并封装移动目录抽屉。 */
export function StandardComposeWorkspace({
  mode,
  chapters,
  activeIndex,
  unit,
  saveStatus,
  editor,
  comparison,
  documentTags,
  identity,
  saveDisabled,
  activeCharCount,
  comparingRevision,
  onCompareRevision,
  onAddChapter,
  createArticle,
  onDeleteChapter,
  deleteMode,
  hiddenChapters,
  onToggleHidden,
  onProofread,
  onSelectChapter,
  onSave,
  onRestore,
  onSync,
  syncing,
  syncDisabled,
  onExpand,
}: {
  mode: EditorMode;
  chapters: readonly { id: string; title: string; volumeTitle?: string }[];
  activeIndex: number;
  /** 当前完整编辑边界；文章、卷、章节和工具能力从这里读取。 */
  unit: ChapterEditingUnit;
  saveStatus: ReactNode;
  editor: ReactNode;
  /** 桌面替换编辑区、窄屏占满正文区的只读比较视图。 */
  comparison?: ReactNode;
  /** 正文下方的整篇文章区域（当前是标签栏）；与章节无关，因此不进编辑器。 */
  documentTags?: ReactNode;
  identity: SeedIdentity;
  /** 各章节的服务器隐藏状态（按目录顺序对齐）。 */
  hiddenChapters?: ReadonlyArray<boolean>;
  /** 章节操作弹窗的隐藏/恢复回调。 */
  onToggleHidden?: (index: number, hidden: boolean) => void;
  /** 章节操作弹窗的校订回调（与阅读页校订一致）。 */
  onProofread?: (index: number) => void;
  saveDisabled: boolean;
  /** 当前章节的真实字数，展示在目录「章节总结」中。 */
  activeCharCount?: number;
  comparingRevision?: number | null;
  onCompareRevision?: (revision: number) => void;
  /** 目录底部「新增章节」入口。 */
  onAddChapter?: () => void;
  /** 空库入口显示为红色「创建文章」。 */
  createArticle?: boolean;
  /** 章节行内「删除章节」入口（带确认，仅改本地草稿）。 */
  onDeleteChapter?: (index: number) => void | Promise<void>;
  deleteMode?: "draft" | "server";
  onSelectChapter: (index: number) => void;
  onSave: () => void;
  onRestore: (revision: number) => void;
  /** 拉取服务器最新内容覆盖编辑器（审核合并、别处保存后使用）。 */
  onSync?: () => void;
  syncing?: boolean;
  syncDisabled?: boolean;
  onExpand: () => void;
}) {
  const [mobileChapterRailOpen, setMobileChapterRailOpen] = useState(false);
  // 切换布局后关闭移动抽屉，入口自身在卸载时清理滚动监听和定时器。
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
          {...(onAddChapter ? { onAddChapter } : {})}
          {...(createArticle !== undefined ? { createArticle } : {})}
          {...(onDeleteChapter ? { onDelete: onDeleteChapter } : {})}
          {...(deleteMode ? { deleteMode } : {})}
          {...(hiddenChapters ? { hiddenChapters } : {})}
          {...(onToggleHidden ? { onToggleHidden } : {})}
          {...(onProofread ? { onProofread } : {})}
          {...(activeCharCount !== undefined ? { activeCharCount } : {})}
          activeRevision={unit.chapter.revision}
        />
        <section className="min-w-0">
          <div className="mb-2 flex min-h-[52px] items-center justify-between gap-3 rounded-lg border border-border bg-white py-2 pr-2.5 pl-3.5 shadow-panel max-[430px]:min-h-12 max-[430px]:pr-3 max-[430px]:pl-3">
            <div className="min-w-0">
              <p className="min-w-0 truncate text-[15px] font-bold">{unit.chapter.title}</p>
              {saveStatus}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {onSync ? (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="同步服务器内容"
                  disabled={syncDisabled || syncing}
                  onClick={onSync}
                >
                  <RefreshCw size={14} className={syncing ? "animate-spin" : undefined} />
                  同步
                </Button>
              ) : null}
              <Button size="sm" disabled={saveDisabled} onClick={onSave}>
                <Save size={14} />
                保存
              </Button>
            </div>
          </div>
          {comparison ?? editor}
          {documentTags ? <div className="mt-2">{documentTags}</div> : null}
        </section>
        {chapterUnitCan(unit, CHAPTER_EDITOR_CAPABILITIES.remoteTools) ? (
          <ForumBusinessPanel
            identity={identity}
            unit={unit}
            {...(comparingRevision !== undefined ? { comparingRevision } : {})}
            {...(onCompareRevision ? { onCompare: onCompareRevision } : {})}
            onRestore={onRestore}
          />
        ) : null}
      </div>
    );
  }

  return (
    <section className="relative">
      {mode === "mobile" ? (
        <>
          <MobileChapterTrigger
            narrowOnly={false}
            open={mobileChapterRailOpen}
            onOpen={() => setMobileChapterRailOpen(true)}
          />
          {mobileChapterRailOpen ? (
            <div className="fixed inset-0 z-50" role="presentation">
              <button
                type="button"
                aria-label="关闭章节目录"
                className="absolute inset-0 bg-black/35"
                onClick={() => setMobileChapterRailOpen(false)}
              />
              <div
                className="absolute inset-y-0 left-0 w-[min(84vw,340px)] overflow-y-auto border-r border-border bg-white p-2 pt-[calc(12px+env(safe-area-inset-top))] shadow-2xl"
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
                  {...(onAddChapter ? { onAddChapter } : {})}
                  {...(createArticle !== undefined ? { createArticle } : {})}
                  {...(onDeleteChapter ? { onDelete: onDeleteChapter } : {})}
                  {...(deleteMode ? { deleteMode } : {})}
                  {...(hiddenChapters ? { hiddenChapters } : {})}
                  {...(onToggleHidden ? { onToggleHidden } : {})}
                  {...(onProofread ? { onProofread } : {})}
                  {...(activeCharCount !== undefined ? { activeCharCount } : {})}
                  activeRevision={unit.chapter.revision}
                  className="static max-h-none rounded-md shadow-none"
                />
                {chapterUnitCan(unit, CHAPTER_EDITOR_CAPABILITIES.remoteTools) ? (
                  <ForumBusinessPanel
                    identity={identity}
                    unit={unit}
                    {...(comparingRevision !== undefined ? { comparingRevision } : {})}
                    {...(onCompareRevision ? { onCompare: onCompareRevision } : {})}
                    onRestore={onRestore}
                    className="static mt-2 max-h-none rounded-md shadow-none"
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      <div className="mx-auto mb-2 flex max-w-[860px] items-center justify-between gap-2 px-1">
        {saveStatus}
        <div className="flex shrink-0 items-center gap-2">
          {onSync ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label="同步服务器内容"
              disabled={syncDisabled || syncing}
              onClick={onSync}
            >
              <RefreshCw size={14} className={syncing ? "animate-spin" : undefined} />
              同步
            </Button>
          ) : null}
          {mode === "compact" ? (
            <Button variant="ghost" size="sm" onClick={onExpand}>
              <Maximize2 size={14} />
              展开
            </Button>
          ) : null}
        </div>
      </div>
      {comparison ?? editor}
      {documentTags ? (
        <div className="mx-auto mt-2 max-w-[860px] px-1">{documentTags}</div>
      ) : null}
    </section>
  );
}
