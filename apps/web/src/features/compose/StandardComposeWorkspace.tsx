import { Maximize2, PanelLeftOpen, Save, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../../components/ui";
import type { EditorMode, RichTextNode, SeedIdentity } from "../../lib/types";
import { ChapterRail, ForumBusinessPanel } from "../forum/ForumPanels";

/** 普通创作展示层：统一完整、极简和移动布局，并封装移动目录抽屉。 */
export function StandardComposeWorkspace({
  mode,
  chapters,
  activeIndex,
  title,
  saveStatus,
  editor,
  comparison,
  identity,
  documentId,
  chapterId,
  revision,
  saveDisabled,
  activeCharCount,
  activeRevision,
  activeContent,
  comparingRevision,
  onCompareRevision,
  onAddChapter,
  onDeleteChapter,
  hiddenChapters,
  onToggleHidden,
  onProofread,
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
  /** 桌面替换编辑区、窄屏占满正文区的只读比较视图。 */
  comparison?: ReactNode;
  identity: SeedIdentity;
  documentId: string;
  /** 当前章节的服务器目录 id；新建章节未注册时为空。 */
  chapterId?: string | undefined;
  /** 各章节的服务器隐藏状态（按目录顺序对齐）。 */
  hiddenChapters?: ReadonlyArray<boolean>;
  /** 章节操作弹窗的隐藏/恢复回调。 */
  onToggleHidden?: (index: number, hidden: boolean) => void;
  /** 章节操作弹窗的校订回调（与阅读页校订一致）。 */
  onProofread?: (index: number) => void;
  revision: number;
  saveDisabled: boolean;
  /** 当前章节的真实字数，展示在目录「章节总结」中。 */
  activeCharCount?: number;
  /** 当前章节的真实修订号，展示在目录「章节总结」中。 */
  activeRevision?: number;
  /** 当前章节正文，用于右侧业务面板匹配附件和投票引用。 */
  activeContent: RichTextNode;
  comparingRevision?: number | null;
  onCompareRevision?: (revision: number) => void;
  /** 目录底部「新增章节」入口。 */
  onAddChapter?: () => void;
  /** 章节行内「删除章节」入口（带确认，仅改本地草稿）。 */
  onDeleteChapter?: (index: number) => void;
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
          {...(onAddChapter ? { onAddChapter } : {})}
          {...(onDeleteChapter ? { onDelete: onDeleteChapter } : {})}
          {...(hiddenChapters ? { hiddenChapters } : {})}
          {...(onToggleHidden ? { onToggleHidden } : {})}
          {...(onProofread ? { onProofread } : {})}
          {...(activeCharCount !== undefined ? { activeCharCount } : {})}
          {...(activeRevision !== undefined ? { activeRevision } : {})}
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
          {comparison ?? editor}
        </section>
        <ForumBusinessPanel
          identity={identity}
          documentId={documentId}
          baseRevision={revision}
          chapterId={chapterId}
          chapterTitle={chapters[activeIndex]?.title ?? title}
          activeContent={activeContent}
          {...(comparingRevision !== undefined ? { comparingRevision } : {})}
          {...(onCompareRevision ? { onCompare: onCompareRevision } : {})}
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
                  {...(onAddChapter ? { onAddChapter } : {})}
                  {...(onDeleteChapter ? { onDelete: onDeleteChapter } : {})}
                  {...(hiddenChapters ? { hiddenChapters } : {})}
                  {...(onToggleHidden ? { onToggleHidden } : {})}
                  {...(onProofread ? { onProofread } : {})}
                  {...(activeCharCount !== undefined ? { activeCharCount } : {})}
                  {...(activeRevision !== undefined ? { activeRevision } : {})}
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
      {comparison ?? editor}
    </section>
  );
}
