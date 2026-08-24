import { Menu } from "lucide-react";

/** 章节导航项（来自文档切分）。 */
export interface TocChapter {
  id: string;
  /** 章节完整标题，按 " · " 拆分为主标题与副标题。 */
  title: string;
}

/** 阅读页左侧章节导航卡片：点击切换当前章节。 */
export function TocSidebar({
  chapters,
  currentIndex,
  onSelect,
}: {
  chapters: readonly TocChapter[];
  currentIndex: number;
  onSelect: (index: number) => void;
}) {
  if (chapters.length === 0) return null;
  return (
    <nav className="sticky top-20 max-h-[calc(100vh-120px)] overflow-y-auto rounded-lg border border-border bg-white p-4 font-serif shadow-panel" aria-label="章节目录">
      <p className="flex items-center gap-1.5 text-[13px] font-bold text-[#37414b]">
        <Menu size={14} aria-hidden="true" />
        目录
      </p>
      <div className="mt-2.5 mb-2 h-px bg-border" aria-hidden="true" />
      <ol className="m-0 grid list-none gap-0.5 p-0">
        {chapters.map((chapter, index) => {
          const [main, sub] = chapter.title.split(" · ");
          const active = index === currentIndex;
          return (
            <li
              key={chapter.id}
              className={active ? "[&_button]:!bg-[#e7f5f2] [&_button]:!font-bold [&_button]:!text-[#14766d]" : ""}
            >
              <button
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => onSelect(index)}
                className="flex w-full items-baseline gap-[7px] overflow-hidden rounded-[5px] border-0 bg-transparent px-2 py-1 text-left text-[13px] font-bold leading-[1.45] text-[#37414b] whitespace-nowrap text-ellipsis cursor-pointer before:content-['•'] before:text-[#0f766e] hover:bg-[#eef5f3] hover:text-[#14766d]"
              >
                <span className="min-w-0 flex-1 truncate">{main}</span>
                {sub ? (
                  <small className="truncate text-[10px] text-muted-foreground">
                    {sub}
                  </small>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
