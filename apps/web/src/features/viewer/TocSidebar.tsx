import { ChevronRight, Menu, PanelLeftOpen, X } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { TextMarquee } from "../../components/ui/text-marquee";

/** 章节导航项（来自文档切分）。 */
export interface TocChapter {
  id: string;
  /** 章节完整标题，按 " · " 拆分为主标题与副标题。 */
  title: string;
  volumeTitle?: string;
}

function TocItems({
  chapters,
  currentIndex,
  onSelect,
}: {
  chapters: readonly TocChapter[];
  currentIndex: number;
  onSelect: (index: number) => void;
}) {
  const [collapsedVolumes, setCollapsedVolumes] = useState<Set<string>>(
    () => new Set(),
  );
  useEffect(() => {
    const volume = chapters[currentIndex]?.volumeTitle?.trim();
    if (!volume) return;
    setCollapsedVolumes((current) => {
      if (!current.has(volume)) return current;
      const next = new Set(current);
      next.delete(volume);
      return next;
    });
  }, [chapters, currentIndex]);
  return (
    <ol className="m-0 grid list-none gap-0.5 p-0">
      {chapters.map((chapter, index) => {
        const [main = "", sub] = chapter.title.split(" · ");
        const active = index === currentIndex;
        const volume = chapter.volumeTitle?.trim() ?? "";
        const startsVolume =
          Boolean(volume) &&
          chapters[index - 1]?.volumeTitle?.trim() !== volume;
        const volumeOpen = !collapsedVolumes.has(volume);
        return (
          <Fragment key={chapter.id}>
          {startsVolume ? (
            <li>
              <button
                type="button"
                className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-bold text-foreground hover:bg-muted"
                aria-label={`${volumeOpen ? "收起" : "展开"}卷 ${volume}`}
                onClick={() =>
                  setCollapsedVolumes((current) => {
                    const next = new Set(current);
                    if (volumeOpen) next.add(volume);
                    else next.delete(volume);
                    return next;
                  })
                }
              >
                <ChevronRight
                  className={volumeOpen ? "rotate-90 transition-transform" : "transition-transform"}
                />
                <span className="truncate">{volume}</span>
              </button>
            </li>
          ) : null}
          {!volume || volumeOpen ? (
          <li
            className={
              `${volume ? "ml-3 " : ""}${active
                ? "[&_button]:!bg-[#e7f5f2] [&_button]:!font-bold [&_button]:!text-[#14766d]"
                : ""}`
            }
          >
            <button
              type="button"
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(index)}
              className="flex w-full cursor-pointer items-baseline gap-[7px] overflow-hidden rounded-[5px] border-0 bg-transparent px-2 py-1 text-left text-[13px] leading-[1.45] font-bold text-[#37414b] before:text-[#0f766e] before:content-['•'] hover:bg-[#eef5f3] hover:text-[#14766d]"
            >
              <span className="min-w-0 flex-1">
                <TextMarquee text={main} className="text-[13px] font-bold leading-[1.45]" />
              </span>
              {sub ? (
                <small className="max-w-[45%] shrink-0 truncate text-[10px] text-muted-foreground">
                  {sub}
                </small>
              ) : null}
            </button>
          </li>
          ) : null}
          </Fragment>
        );
      })}
    </ol>
  );
}

/** 阅读页章节导航：桌面显示侧栏，移动端显示独立目录抽屉。 */
export function TocSidebar({
  chapters,
  currentIndex,
  onSelect,
}: {
  chapters: readonly TocChapter[];
  currentIndex: number;
  onSelect: (index: number) => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  if (chapters.length === 0) return null;
  return (
    <>
      <nav
        className="sticky top-20 max-h-[calc(100vh-120px)] overflow-y-auto rounded-lg border border-border bg-white p-4 font-serif shadow-panel"
        aria-label="章节目录"
      >
        <p className="flex items-center gap-1.5 text-[13px] font-bold text-[#37414b]">
          <Menu size={14} aria-hidden="true" />
          目录
        </p>
        <div className="mt-2.5 mb-2 h-px bg-border" aria-hidden="true" />
        <TocItems
          chapters={chapters}
          currentIndex={currentIndex}
          onSelect={onSelect}
        />
      </nav>

      <Button
        variant="outline"
        size="icon"
        aria-label="打开阅读目录"
        aria-expanded={mobileOpen}
        className="fixed top-[76px] left-2 z-30 hidden h-11 w-11 bg-white shadow-panel max-[840px]:inline-flex"
        onClick={() => setMobileOpen(true)}
      >
        <PanelLeftOpen size={20} />
      </Button>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-50 hidden max-[840px]:block"
          role="presentation"
        >
          <button
            type="button"
            aria-label="关闭阅读目录"
            className="absolute inset-0 bg-black/35"
            onClick={() => setMobileOpen(false)}
          />
          <div
            className="absolute inset-y-0 left-0 w-[min(84vw,340px)] overflow-y-auto border-r border-border bg-white p-3 pt-[calc(12px+env(safe-area-inset-top))] font-serif shadow-2xl"
            role="dialog"
            aria-label="阅读章节目录"
            aria-modal="true"
          >
            <div className="mb-3 flex items-center justify-between">
              <strong className="flex items-center gap-1.5 text-sm">
                <Menu size={15} aria-hidden="true" />
                章节目录
              </strong>
              <Button
                variant="ghost"
                size="icon"
                aria-label="关闭阅读目录"
                onClick={() => setMobileOpen(false)}
              >
                <X size={18} />
              </Button>
            </div>
            <TocItems
              chapters={chapters}
              currentIndex={currentIndex}
              onSelect={(index) => {
                onSelect(index);
                setMobileOpen(false);
              }}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
