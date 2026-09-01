import { BookOpen, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { cn } from "../../lib/utils";

/** 完整创作模式左侧的章节目录：点击切换当前编辑章节。 */
export function ChapterRail({
  chapters,
  currentIndex,
  onSelect,
  onAddChapter,
  onDelete,
  activeCharCount,
  activeRevision,
  className,
}: {
  chapters: readonly { id: string; title: string }[];
  currentIndex: number;
  onSelect: (index: number) => void;
  /** 目录底部「新增章节」入口；不提供时隐藏。 */
  onAddChapter?: () => void;
  /** 章节行内删除入口；不提供时隐藏。删除只改本地草稿，保存后才同步服务器。 */
  onDelete?: (index: number) => void;
  /** 当前章节的真实字数（未提供时显示占位）。 */
  activeCharCount?: number;
  /** 当前章节的真实修订号。 */
  activeRevision?: number;
  className?: string;
}) {
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const pendingChapter =
    pendingDelete !== null ? chapters[pendingDelete] : undefined;

  return (
    <aside
      className={cn(
        "sticky top-[76px] max-h-[calc(100vh-92px)] overflow-auto rounded-lg border border-border bg-white shadow-panel",
        className,
      )}
      aria-label="章节目录"
    >
      <div className="border-b border-border p-3.5 last:border-b-0">
        <div className="mb-[11px] flex items-center justify-between gap-2 text-[13px] font-bold">
          <span className="flex items-center gap-2">
            <BookOpen size={15} />
            章节目录
          </span>
          <Badge tone="teal">创作中</Badge>
        </div>
        <nav>
          {chapters.map((chapter, order) => {
            const [main, sub] = chapter.title.split(" · ");
            const active = order === currentIndex;
            return (
              <div key={chapter.id} className="group relative">
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-[9px] rounded-[5px] px-2.5 py-[9px] pr-9 text-left text-[13px] text-[#4c5761] hover:bg-[#edf7f5] hover:text-[#176e66] data-[active=true]:bg-[#edf7f5] data-[active=true]:text-[#176e66]"
                  data-active={active}
                  onClick={() => onSelect(order)}
                >
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate font-semibold">
                      {main}
                    </strong>
                    {sub ? (
                      <small className="block truncate text-[10px] text-muted-foreground">
                        {sub}
                      </small>
                    ) : null}
                  </span>
                  <ChevronRight size={13} />
                </button>
                {onDelete ? (
                  <button
                    type="button"
                    aria-label={`删除章节 ${chapter.title}`}
                    title="删除章节（仅本地草稿，保存后才会同步到服务器）"
                    onClick={() => setPendingDelete(order)}
                    className="absolute top-1/2 right-7 grid h-[22px] w-[22px] -translate-y-1/2 cursor-pointer place-items-center rounded border-0 bg-transparent text-[#a8544d] opacity-0 transition-opacity hover:bg-[#fbeae8] hover:text-[#a33028] focus-visible:opacity-100 group-hover:opacity-100 max-[640px]:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </nav>
        {onAddChapter ? (
          <button
            type="button"
            onClick={onAddChapter}
            className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1 rounded-[5px] border border-dashed border-[#b7c9c3] px-2.5 py-2 text-xs font-semibold text-[#176e66] hover:bg-[#edf7f5]"
          >
            <Plus size={13} />
            新增章节
          </button>
        ) : null}
      </div>
      <div className="border-b border-border p-3.5 last:border-b-0">
        <p className="mb-2 text-xs font-semibold tracking-normal text-muted-foreground uppercase">
          章节总结
        </p>
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">字数</dt>
            <dd className="mt-1 font-bold">
              {activeCharCount !== undefined
                ? activeCharCount.toLocaleString()
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">修订</dt>
            <dd className="mt-1 font-bold">
              {activeRevision !== undefined
                ? activeRevision.toLocaleString()
                : "—"}
            </dd>
          </div>
        </dl>
      </div>
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>删除章节</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{pendingChapter?.title ?? ""}」及其正文。此操作只修改
              本地草稿，点击「保存」后才会同步到服务器。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDelete !== null) onDelete?.(pendingDelete);
                setPendingDelete(null);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
