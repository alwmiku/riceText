import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { readerPageState, type ReaderPageState } from "@ricetext/document-core";
import { READER_MOBILE_QUERY, READER_COLUMN_GAP, readerBodyHeight, readerColumnCount, resizeReaderPages } from "./reader-pagination.js";

function mobileSnapshot() { return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(READER_MOBILE_QUERY).matches; }
function subscribeMobile(listener: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(READER_MOBILE_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

/** 分页使用浏览器的 CSS 分片引擎，不拆分或重写文档节点。 */
export function useReaderPagination(enabled: boolean) {
  const mobile = useSyncExternalStore(subscribeMobile, mobileSnapshot, () => false);
  const paginated = enabled && mobile;
  const pageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<ReaderPageState>({ index: 0, count: 1 });
  const lastMobilePages = useRef(pages);
  const activePages = paginated ? pages : { index: 0, count: 1 };

  useLayoutEffect(() => {
    const page = pageRef.current;
    const viewport = viewportRef.current;
    if (!page || !viewport || !paginated) return;
    let disposed = false;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (disposed) return;
      const content = viewport.querySelector<HTMLElement>(".rt-novel-excerpt__content");
      const columns = content?.querySelector<HTMLElement>("[data-node-view-content-react]");
      const width = viewport.getBoundingClientRect().width;
      if (!content || !columns || width === 0) return;
      const style = getComputedStyle(page);
      let chromeHeight = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      for (const child of Array.from(page.children)) {
        if (child === viewport) continue;
        const childStyle = getComputedStyle(child);
        chromeHeight += child.getBoundingClientRect().height + parseFloat(childStyle.marginTop || "0") + parseFloat(childStyle.marginBottom || "0");
      }
      const lineHeight = parseFloat(getComputedStyle(content).lineHeight);
      const height = readerBodyHeight(window.innerHeight, chromeHeight, lineHeight);
      viewport.style.setProperty("--reader-body-height", height + "px");
      viewport.style.setProperty("--reader-column-width", width + "px");
      viewport.style.setProperty("--reader-column-gap", READER_COLUMN_GAP + "px");
      const count = readerColumnCount(columns.scrollWidth, width);
      setPages(previous => {
        const next = resizeReaderPages(lastMobilePages.current, count);
        lastMobilePages.current = next;
        return previous.index === next.index && previous.count === next.count ? previous : next;
      });
    };
    const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(measure); };
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    resize?.observe(page);
    resize?.observe(viewport);
    const mutations = new MutationObserver(schedule);
    mutations.observe(page, { childList: true, subtree: true, characterData: true });
    const content = viewport.querySelector("[data-node-view-content-react]");
    if (content) mutations.observe(content, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["style", "class"] });
    window.addEventListener("resize", schedule);
    page.addEventListener("load", schedule, true);
    document.fonts?.addEventListener("loadingdone", schedule);
    void document.fonts?.ready.then(schedule);
    measure();
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize?.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      page.removeEventListener("load", schedule, true);
      document.fonts?.removeEventListener("loadingdone", schedule);
    };
  }, [paginated]);

  const goToPage = useCallback((index: number) => {
    if (!paginated) return;
    setPages(previous => {
      const next = readerPageState(index, previous.count);
      lastMobilePages.current = next;
      return next.index === previous.index ? previous : next;
    });
  }, [paginated]);
  const pointer = useRef<{ id: number; x: number; y: number; time: number; selection: boolean } | null>(null);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!paginated || event.button !== 0 || !event.isPrimary || (event.target as Element).closest("a, button, input, textarea, [contenteditable=true]")) return;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp, selection: !window.getSelection()?.isCollapsed };
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointer.current;
    pointer.current = null;
    if (!start || start.id !== event.pointerId || start.selection || !window.getSelection()?.isCollapsed || event.timeStamp - start.time > 450 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    goToPage(pages.index + (event.clientX - bounds.left < bounds.width / 2 ? -1 : 1));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!paginated || event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const targets: Record<string, number> = { ArrowLeft: pages.index - 1, ArrowRight: pages.index + 1, Home: 0, End: pages.count - 1 };
    if (!(event.key in targets)) return;
    event.preventDefault();
    event.stopPropagation();
    goToPage(targets[event.key]!);
  };
  return { pageRef, viewportRef, paginated, pages: activePages, goToPage,
    onPointerDown, onPointerUp, onPointerCancel: () => { pointer.current = null; }, onKeyDown };
}
