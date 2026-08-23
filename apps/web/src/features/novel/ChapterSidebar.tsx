import type { Editor } from "@tiptap/react";
import { MAX_CHAPTER_LENGTH } from "@ricetext/editor-core";
import { ArrowDown, ArrowUp, Combine, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

interface ChapterItem {
  id: string;
  title: string;
  text: string;
  order: number;
  pos: number;
  nodeSize: number;
}

function collectChapters(editor: Editor): ChapterItem[] {
  const items: ChapterItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "longTextBlock") {
      items.push({
        id: String(node.attrs.chapterId ?? ""),
        title: String(node.attrs.title ?? "未命名章节"),
        text: String(node.attrs.text ?? ""),
        order: Number(node.attrs.order ?? 0),
        pos,
        nodeSize: node.nodeSize,
      });
    }
    return true;
  });
  return items;
}

/** 长文本模式下的章节列表侧栏：点击跳转、删除、合并、上下移动排序。 */
export function ChapterSidebar({ editor }: { editor: Editor | null }) {
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!editor) return;
    const update = () => setChapters(collectChapters(editor));
    update();
    editor.on("transaction", update);
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("transaction", update);
      editor.off("selectionUpdate", update);
    };
  }, [editor]);

  const focusChapter = (item: ChapterItem) => {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .setNodeSelection(item.pos)
      .scrollIntoView()
      .run();
    window.requestAnimationFrame(() => {
      for (const element of editor.view.dom.querySelectorAll<HTMLElement>(
        "[data-chapter-id]",
      )) {
        if (element.dataset.chapterId === item.id) {
          element.scrollIntoView({ block: "start", behavior: "smooth" });
          break;
        }
      }
    });
  };

  const deleteChapter = (index: number) => {
    if (!editor) return;
    const item = chapters[index];
    if (!item) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: item.pos, to: item.pos + item.nodeSize })
      .run();
  };

  const canMergeChapter = (index: number) => {
    if (index <= 0) return false;
    const current = chapters[index];
    const previous = chapters[index - 1];
    return Boolean(
      current &&
        previous &&
        previous.text.length + current.text.length + 2 <= MAX_CHAPTER_LENGTH,
    );
  };

  const mergeChapter = (index: number) => {
    if (!editor || !canMergeChapter(index)) return;
    const current = chapters[index];
    const previous = chapters[index - 1];
    if (!current || !previous) return;
    const combinedText = `${previous.text}\n\n${current.text}`;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        const prevNode = tr.doc.nodeAt(previous.pos);
        if (prevNode) {
          tr.setNodeMarkup(previous.pos, undefined, {
            ...prevNode.attrs,
            text: combinedText,
          });
        }
        tr.delete(current.pos, current.pos + current.nodeSize);
        return true;
      })
      .run();
  };

  const moveChapterTo = (fromIndex: number, toIndex: number) => {
    if (!editor) return;
    if (fromIndex === toIndex) return;
    if (toIndex < 0 || toIndex >= chapters.length) return;
    const moving = chapters[fromIndex];
    const target = chapters[toIndex];
    if (!moving || !target) return;

    const from = moving.pos;
    const to = moving.pos + moving.nodeSize;
    const nodeJson = editor.state.doc.nodeAt(moving.pos)?.toJSON();
    if (!nodeJson) return;

    const insertAt =
      toIndex > fromIndex ? target.pos + target.nodeSize : target.pos;

    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.delete(from, to);
        const adjustedInsert =
          insertAt > from ? insertAt - (to - from) : insertAt;
        const node = tr.doc.type.schema.nodeFromJSON(nodeJson);
        tr.insert(adjustedInsert, node);
        return true;
      })
      .run();
  };

  if (!editor) return null;

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
              className={`chapter-sidebar__item${dragIndex === index ? " chapter-sidebar__item--dragging" : ""}`}
              role="button"
              tabIndex={0}
              draggable
              onClick={() => focusChapter(chapter)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  focusChapter(chapter);
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
                  moveChapterTo(source, index);
                }
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
            >
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-xs">
                  {chapter.title}
                </strong>
                <small className="text-[10px] text-muted-foreground">
                  {chapter.text.length.toLocaleString()} 字
                </small>
              </div>

              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label="上移"
                  disabled={index === 0}
                  onClick={(event) => {
                    event.stopPropagation();
                    moveChapterTo(index, index - 1);
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
                    moveChapterTo(index, index + 1);
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
                    mergeChapter(index);
                  }}
                >
                  <Combine size={13} />
                </button>
                <button
                  type="button"
                  aria-label="删除章节"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteChapter(index);
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
