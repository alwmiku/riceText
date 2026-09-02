import {
  BookOpen,
  ChevronRight,
  Eye,
  EyeOff,
  FilePlus2,
  GitCompareArrows,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Badge, Button } from "../../components/ui";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { cn } from "../../lib/utils";

/** 完整创作模式左侧的章节目录：点击切换当前编辑章节。 */
export function ChapterRail({
  chapters,
  currentIndex,
  onSelect,
  onAddChapter,
  createArticle,
  onDelete,
  hiddenChapters,
  onToggleHidden,
  onProofread,
  activeCharCount,
  activeRevision,
  className,
}: {
  chapters: readonly { id: string; title: string }[];
  currentIndex: number;
  onSelect: (index: number) => void;
  /** 目录底部「新增章节」入口；不提供时隐藏。 */
  onAddChapter?: () => void;
  /** 空库尚无本地文章时，将同一入口强调为红色「创建文章」。 */
  createArticle?: boolean;
  /** 章节操作弹窗中的删除入口；不提供时隐藏。删除只改本地草稿，保存后才同步服务器。 */
  onDelete?: (index: number) => void;
  /** 各章节的服务器隐藏状态（按目录顺序对齐）；未提供时视为全部可读。 */
  hiddenChapters?: ReadonlyArray<boolean>;
  /** 章节操作弹窗中的隐藏/恢复入口；不提供时隐藏。 */
  onToggleHidden?: (index: number, hidden: boolean) => void;
  /** 章节操作弹窗中的校订入口（与阅读页「开始校订」一致）；不提供时隐藏。 */
  onProofread?: (index: number) => void;
  /** 当前章节的真实字数（未提供时显示占位）。 */
  activeCharCount?: number;
  /** 当前章节的真实修订号。 */
  activeRevision?: number;
  className?: string;
}) {
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [menuIndex, setMenuIndex] = useState<number | null>(null);
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
            const hidden = hiddenChapters?.[order] ?? false;
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
                  {hidden ? <Badge tone="amber">已隐藏</Badge> : null}
                </button>
                {/* 右向箭头：打开章节操作弹窗（删除/隐藏/校订）。 */}
                <Popover
                  open={menuIndex === order}
                  onOpenChange={(open) => setMenuIndex(open ? order : null)}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={`打开章节操作 ${chapter.title}`}
                      title="章节操作"
                      className="absolute top-1/2 right-1.5 grid h-[24px] w-[24px] -translate-y-1/2 cursor-pointer place-items-center rounded border-0 bg-transparent text-[#8a949d] hover:bg-[#edf7f5] hover:text-[#176e66]"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" sideOffset={8} className="w-44 p-1.5">
                    <div className="flex flex-col gap-1">
                      {onDelete ? (
                        <button
                          type="button"
                          onClick={() => {
                            setMenuIndex(null);
                            setPendingDelete(order);
                          }}
                          className="flex w-full cursor-pointer items-center gap-2 rounded-md bg-destructive px-2 py-2 text-xs font-semibold text-white hover:bg-destructive/90"
                        >
                          <Trash2 size={13} />
                          删除章节
                        </button>
                      ) : null}
                      {onToggleHidden ? (
                        <button
                          type="button"
                          onClick={() => {
                            setMenuIndex(null);
                            onToggleHidden(order, !hidden);
                          }}
                          className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-2 text-xs font-medium text-[#4c5761] hover:bg-muted"
                        >
                          {hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                          {hidden ? "取消隐藏" : "隐藏章节"}
                        </button>
                      ) : null}
                      {onProofread ? (
                        <button
                          type="button"
                          onClick={() => {
                            setMenuIndex(null);
                            onProofread(order);
                          }}
                          className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-2 text-xs font-medium text-[#4c5761] hover:bg-muted"
                        >
                          <GitCompareArrows size={13} />
                          校订章节
                        </button>
                      ) : null}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            );
          })}
        </nav>
        {onAddChapter ? (
          <Button
            type="button"
            size="sm"
            variant={createArticle ? "destructive" : "outline"}
            onClick={onAddChapter}
            className="mt-2 w-full border-dashed"
          >
            {createArticle ? (
              <FilePlus2 data-icon="inline-start" />
            ) : (
              <Plus data-icon="inline-start" />
            )}
            {createArticle ? "创建文章" : "新增章节"}
          </Button>
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
