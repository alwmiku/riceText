import { PanelLeftOpen } from "lucide-react";
import { createPortal } from "react-dom";
import { useMobileChapterTrigger } from "../hooks/useMobileChapterTrigger";
import { cn } from "../lib/utils";
import { Button } from "./ui";

/** 编辑页和阅读页共用的浮动目录入口，不占据正文顶部的布局空间。 */
export function MobileChapterTrigger({ open, onOpen, narrowOnly = true }: { open: boolean; onOpen: () => void; narrowOnly?: boolean }) {
  const { revealed, reveal } = useMobileChapterTrigger(open, narrowOnly);
  return createPortal(
    <Button variant="outline" size="icon" aria-label="打开章节目录" aria-expanded={open}
      data-revealed={revealed}
      className={cn(
        "fixed top-[calc(76px+env(safe-area-inset-top))] z-30 size-11 bg-background shadow-panel transition-[left,transform,opacity] duration-200 ease-out motion-reduce:transition-none",
        narrowOnly && "hidden max-[840px]:inline-flex",
        revealed ? "left-2 translate-x-0 opacity-100" : "left-0 -translate-x-[58%] opacity-70 focus-visible:translate-x-0 focus-visible:opacity-100",
      )}
      onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) reveal(); }}
      onClick={() => { reveal(); onOpen(); }}>
      <PanelLeftOpen data-icon="inline-start" />
    </Button>,
    document.body,
  );
}
