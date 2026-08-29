import type { CSSProperties, ComponentProps } from "react";
import { Slider as SliderPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/** shadcn 风格滑条（基于 Radix Slider）：支持自定义轨道渐变与可选填充段。 */
function Slider({
  className,
  trackClassName,
  trackStyle,
  rangeClassName,
  rangeStyle,
  showRange = true,
  thumbAriaLabel,
  ...props
}: ComponentProps<typeof SliderPrimitive.Root> & {
  /** 轨道额外类名（用于自定义渐变背景）。 */
  trackClassName?: string;
  /** 轨道内联样式（用于自定义渐变背景）。 */
  trackStyle?: CSSProperties;
  /** 已选填充段额外类名。 */
  rangeClassName?: string;
  /** 已选填充段内联样式。 */
  rangeStyle?: CSSProperties;
  /** 是否渲染已选填充段（渐变轨道滑条通常不需要）。 */
  showRange?: boolean;
  /** 拇指的可访问名称（Radix 的 aria-label 需落在 thumb 上）。 */
  thumbAriaLabel?: string;
}) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex w-full touch-none select-none items-center data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        className={cn(
          "relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary/20",
          trackClassName,
        )}
        style={trackStyle}
      >
        {showRange && (
          <SliderPrimitive.Range
            className={cn("absolute h-full", rangeClassName)}
            style={rangeStyle}
          />
        )}
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={thumbAriaLabel}
        className="block size-4 shrink-0 rounded-full border-2 border-white bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none"
      />
    </SliderPrimitive.Root>
  );
}

export { Slider };
