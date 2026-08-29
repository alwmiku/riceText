import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

function Popover(props: ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger(
  props: ComponentProps<typeof PopoverPrimitive.Trigger>,
) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverAnchor(props: ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

/** 通过 Portal 渲染的浮动面板；定位与碰撞规避由 Radix 负责。 */
function PopoverContent({
  className,
  align = "center",
  sideOffset = 6,
  position,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content> & {
  align?: "start" | "center" | "end";
  sideOffset?: number;
  /** 定位模式：absolute（默认，跟随页面滚动）或 fixed（相对视口）。 */
  position?: "absolute" | "fixed";
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        {...(position ? { position } : {})}
        className={cn(
          "z-50 origin-[var(--radix-popover-content-transform-origin)] rounded-lg border border-border bg-white p-1 text-foreground shadow-xl outline-none",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
