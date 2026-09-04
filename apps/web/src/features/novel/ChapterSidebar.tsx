import { MAX_CHAPTER_LENGTH } from "@ricetext/editor-core";
import { ArrowDown, ArrowUp, ChevronRight, Combine, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";
import { cn } from "../../lib/utils";

/** 目录中的单个章节摘要。 */
export interface ChapterSummary {
  id: string;
  title: string;
  volumeTitle?: string;
  charCount: number;
}

interface ChapterSidebarProps {
  /** 全部章节摘要；操作按索引进行。 */
  chapters: readonly ChapterSummary[];
  /** 当前正在编辑的章节索引。 */
  activeIndex: number;
  onSelect: (index: number) => void;
  onDelete: (index: number) => void;
  onMerge: (index: number) => void;
  onMove: (from: number, to: number) => void;
}

/**
 * 长文本模式的章节目录：点击切换、拖拽排序、合并、删除。
 * 目录数据由宿主提供，本组件不接触编辑器实例，避免遍历大文档。
 */
export function ChapterSidebar({
  chapters,
  activeIndex,
  onSelect,
  onDelete,
  onMerge,
  onMove,
}: ChapterSidebarProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [collapsedVolumes, setCollapsedVolumes] = useState<Set<string>>(
    () => new Set(),
  );
  const groups = useMemo(() => {
    const result: Array<{
      title: string;
      items: Array<{ chapter: ChapterSummary; index: number }>;
    }> = [];
    chapters.forEach((chapter, index) => {
      const title = chapter.volumeTitle?.trim() ?? "";
      const previous = result.at(-1);
      if (!previous || previous.title !== title) {
        result.push({ title, items: [{ chapter, index }] });
      } else {
        previous.items.push({ chapter, index });
      }
    });
    return result;
  }, [chapters]);

  useEffect(() => {
    const activeVolume = chapters[activeIndex]?.volumeTitle?.trim();
    if (!activeVolume) return;
    setCollapsedVolumes((current) => {
      if (!current.has(activeVolume)) return current;
      const next = new Set(current);
      next.delete(activeVolume);
      return next;
    });
  }, [activeIndex, chapters]);

  const canMergeChapter = (index: number) => {
    if (index <= 0) return false;
    const current = chapters[index];
    const previous = chapters[index - 1];
    return Boolean(
      current &&
      previous &&
      previous.charCount + current.charCount + 2 <= MAX_CHAPTER_LENGTH,
    );
  };

  return (
    <aside
      className="sticky top-[116px] max-h-[calc(100vh-140px)] overflow-auto rounded-lg border border-border bg-white p-2.5 shadow-panel"
      aria-label="章节列表"
    >
      <div className="mb-[11px] flex items-center justify-between gap-2 text-[13px] font-bold">
        <span>章节列表</span>
        <span className="text-xs font-normal text-muted-foreground">
          {chapters.length} 章
        </span>
      </div>

      {chapters.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">暂无章节</p>
      ) : (
        <div className="flex flex-col gap-1">
          {groups.map((group, groupIndex) => {
            const rows = group.items.map(({ chapter, index }) => (
            <div
              key={chapter.id || index}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-md p-1.5 hover:bg-[#edf7f5]",
                group.title && "ml-3",
                index === activeIndex &&
                  "bg-[#e2efec] outline outline-1 outline-[#9ccfc6]",
                dragIndex === index &&
                  "opacity-50 outline-dashed outline-1 outline-[#197c73]",
              )}
              role="button"
              tabIndex={0}
              draggable
              onClick={() => onSelect(index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(index);
                }
              }}
              onDragStart={(event) => {
                setDragIndex(index);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(index));
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const source =
                  dragIndex ?? Number(event.dataTransfer.getData("text/plain"));
                if (Number.isFinite(source) && source !== index) {
                  onMove(source, index);
                }
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
            >
              <div className="min-w-0 flex-1">
                <strong className="line-clamp-2 break-all text-xs font-semibold leading-[1.35]">
                  {chapter.title}
                </strong>
                <small className="text-[10px] text-muted-foreground">
                  {chapter.charCount.toLocaleString()} 字
                </small>
              </div>

              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label="上移"
                  disabled={index === 0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onMove(index, index - 1);
                  }}
                  className="grid h-[22px] w-[22px] cursor-pointer place-items-center rounded border-0 bg-transparent text-[#6b7a76] hover:bg-[#e2efec] hover:text-[#176e66] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  aria-label="下移"
                  disabled={index === chapters.length - 1}
                  onClick={(event) => {
                    event.stopPropagation();
                    onMove(index, index + 1);
                  }}
                  className="grid h-[22px] w-[22px] cursor-pointer place-items-center rounded border-0 bg-transparent text-[#6b7a76] hover:bg-[#e2efec] hover:text-[#176e66] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  type="button"
                  aria-label="合并到上一章"
                  title={
                    canMergeChapter(index)
                      ? "合并到上一章"
                      : "合并后将超过 50000 字"
                  }
                  disabled={!canMergeChapter(index)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onMerge(index);
                  }}
                  className="grid h-[22px] w-[22px] cursor-pointer place-items-center rounded border-0 bg-transparent text-[#6b7a76] hover:bg-[#e2efec] hover:text-[#176e66] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <Combine size={13} />
                </button>
                <button
                  type="button"
                  aria-label="删除章节"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(index);
                  }}
                  className="grid h-[22px] w-[22px] cursor-pointer place-items-center rounded border-0 bg-transparent text-[#6b7a76] hover:bg-[#e2efec] hover:text-[#176e66] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            ));
            if (!group.title) return <div key={`plain-${groupIndex}`}>{rows}</div>;
            const open = !collapsedVolumes.has(group.title);
            return (
              <Collapsible
                key={`${group.title}-${groupIndex}`}
                open={open}
                onOpenChange={(nextOpen) =>
                  setCollapsedVolumes((current) => {
                    const next = new Set(current);
                    if (nextOpen) next.delete(group.title);
                    else next.add(group.title);
                    return next;
                  })
                }
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-bold text-foreground hover:bg-muted"
                    aria-label={`${open ? "收起" : "展开"}卷 ${group.title}`}
                  >
                    <ChevronRight
                      data-icon="inline-start"
                      className={cn("transition-transform", open && "rotate-90")}
                    />
                    <span className="min-w-0 flex-1 truncate">{group.title}</span>
                    <span className="font-normal text-muted-foreground">
                      {group.items.length} 章
                    </span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="flex flex-col gap-1">
                  {rows}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      )}
    </aside>
  );
}
