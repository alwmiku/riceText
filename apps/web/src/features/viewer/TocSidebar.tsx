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
    <nav className="viewer-toc surface p-4" aria-label="章节目录">
      <p className="viewer-toc__heading">
        <Menu size={14} aria-hidden="true" />
        目录
      </p>
      <div className="viewer-toc__divider" aria-hidden="true" />
      <ol className="viewer-toc__list">
        {chapters.map((chapter, index) => {
          const [main, sub] = chapter.title.split(" · ");
          const active = index === currentIndex;
          return (
            <li
              key={chapter.id}
              className={`viewer-toc__item viewer-toc__item--h1${active ? " viewer-toc__item--active" : ""}`}
            >
              <button
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => onSelect(index)}
              >
                <span className="viewer-toc__number">
                  {String(index).padStart(2, "0")}
                </span>
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
