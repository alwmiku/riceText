import type { ViewerTocItem } from "@ricetext/editor-core";

/** 滚动到正文中对应索引的标题元素。 */
function scrollToHeading(index: number): void {
  globalThis.document
    .querySelector(`[data-toc-index="${index}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** 阅读页左侧目录卡片：根据正文标题生成，点击平滑跳转。 */
export function TocSidebar({ items }: { items: readonly ViewerTocItem[] }) {
  if (items.length === 0) return null;
  return (
    <nav className="viewer-toc surface p-4" aria-label="正文目录">
      <p className="section-label">目录</p>
      <ol className="viewer-toc__list">
        {items.map((item) => (
          <li
            key={item.index}
            className={`viewer-toc__item viewer-toc__item--h${item.level}`}
          >
            <button type="button" onClick={() => scrollToHeading(item.index)}>
              {item.text}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
