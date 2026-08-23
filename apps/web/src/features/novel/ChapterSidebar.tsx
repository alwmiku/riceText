import { MAX_CHAPTER_LENGTH } from "@ricetext/editor-core";
import { ArrowDown, ArrowUp, Combine, Trash2 } from "lucide-react";
import { useState } from "react";

/** 目录中的单个章节摘要。 */
export interface ChapterSummary {
  id: string;
  title: string;
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
    <aside className="chapter-sidebar surface" aria-label="章节列表">
      <div className="side-heading">
        <span>章节列表</span>
        <span className="text-xs font-normal text-muted-foreground">
          {chapters.length} 章
        </span>
      </div>

      {chapters.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">暂无章节</p>
      ) : (
        <div className="space-y-1">
          {chapters.map((chapter, index) => (
            <div
              key={chapter.id || index}
              className={`chapter-sidebar__item${index === activeIndex ? " chapter-sidebar__item--active" : ""}${dragIndex === index ? " chapter-sidebar__item--dragging" : ""}`}
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
                <strong className="chapter-sidebar__title">
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
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
