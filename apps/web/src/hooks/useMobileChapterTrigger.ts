import { useCallback, useEffect, useRef, useState } from "react";

/** 目录入口跟随视口：文字上移时收边，文字下移时显现。 */
export function useMobileChapterTrigger(open: boolean, narrowOnly = true) {
  const [revealed, setRevealed] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const selectionActive = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const tuckLater = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => {
      if (!openRef.current && !selectionActive.current) setRevealed(false);
    }, 1800);
  }, [clearTimer]);
  const reveal = useCallback(() => {
    setRevealed(true);
    tuckLater();
  }, [tuckLater]);

  useEffect(() => {
    let lastY = Math.max(0, window.scrollY);
    let distance = 0;
    let direction = 0;
    const onScroll = () => {
      const y = Math.max(0, window.scrollY);
      const delta = y - lastY;
      lastY = y;
      if (!delta || (narrowOnly && window.innerWidth > 840)) return;
      const nextDirection = Math.sign(delta);
      distance = nextDirection === direction ? distance + delta : delta;
      direction = nextDirection;
      // 累计小幅滚动，避免触控滚动每帧不足阈值时一直不响应。
      if (Math.abs(distance) < 8) return;
      distance = 0;
      if (delta < 0) reveal();
      else if (!openRef.current && !selectionActive.current) {
        clearTimer();
        setRevealed(false);
      }
    };
    const onSelectionChange = () => {
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      const element = anchor instanceof Element ? anchor : anchor?.parentElement;
      selectionActive.current = Boolean(selection && !selection.isCollapsed && element?.closest('[aria-label="正文编辑区"], .rt-viewer'));
      if (selectionActive.current) {
        clearTimer();
        setRevealed(true);
      } else tuckLater();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("selectionchange", onSelectionChange);
      clearTimer();
    };
  }, [clearTimer, narrowOnly, reveal, tuckLater]);

  useEffect(() => {
    if (open) clearTimer();
    else tuckLater();
  }, [open, clearTimer, tuckLater]);

  return { revealed: open || revealed, reveal };
}
