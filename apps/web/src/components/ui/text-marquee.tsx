import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";

/**
 * 单行标题轮播：
 * - 内容溢出时，桌面端鼠标悬停后整体缓慢左右往复滚动（CSS 动画，无 JS 帧循环），
 *   悬停结束回到截断省略态；
 * - 移动端无 hover（触摸），保持 text-ellipsis 截取过长文字；
 * - 不溢出（短标题）时完全静止，避免无意义动画。
 */
export function TextMarquee({ text, className }: { text: string; className?: string }) {
  const outerRef = useRef<HTMLSpanElement | null>(null);
  const innerRef = useRef<HTMLSpanElement | null>(null);
  const [distance, setDistance] = useState(0);
  const [hovered, setHovered] = useState(false);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const measure = () => {
      const overflow = inner.scrollWidth - outer.clientWidth;
      setDistance(overflow > 2 ? overflow : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [text]);

  const running = distance > 0 && hovered;
  // 越长滚动越慢，给出可读节奏（4–12s 往复一次）。
  const duration = Math.min(12, Math.max(4, distance / 60));

  return (
    <span ref={outerRef} className={cn("block min-w-0 overflow-hidden", className)}>
      <span
        ref={innerRef}
        className={cn(
          "block whitespace-nowrap",
          running ? "w-max overflow-visible" : "overflow-hidden text-ellipsis",
        )}
        style={
          running
            ? {
                ["--marquee-distance" as string]: distance + "px",
                animation: "text-marquee " + duration + "s ease-in-out infinite alternate",
              }
            : undefined
        }
        onMouseEnter={() => {
          if (distance > 0) setHovered(true);
        }}
        onMouseLeave={() => setHovered(false)}
      >
        {text}
      </span>
    </span>
  );
}
