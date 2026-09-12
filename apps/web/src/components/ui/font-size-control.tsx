import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 字号控件：预设下拉 + 自定义输入（纯数字 px）。
 *
 * 白名单由契约给出（12–512px），自定义输入会收窄到同一区间后再套用，
 * 因此「随手输个 400」也能存下来并把表情一起放大。
 */
export function FontSizeControl({
  value,
  sizes,
  min,
  max,
  disabled,
  className,
  ariaLabel = "字号",
  onCommit,
}: {
  /** 当前生效的字号，形如 "16px"。 */
  value: string;
  /** 预设档位，形如 ["12px", ...]。 */
  sizes: readonly string[];
  /** 自定义输入允许的区间。 */
  min: number;
  max: number;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  /** 提交回调；入参是归一化后的 px 值。 */
  onCommit: (size: number) => void;
}) {
  const current = Number.parseInt(value, 10);
  const isPreset = sizes.includes(value);
  const [custom, setCustom] = useState(() => String(Number.isFinite(current) ? current : ""));

  // 选区变化时同步显示值；预设之外的档位在输入框里体现。
  useEffect(() => {
    const parsed = Number.parseInt(value, 10);
    setCustom(Number.isFinite(parsed) ? String(parsed) : "");
  }, [value]);

  const commit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      const fallback = Number.parseInt(value, 10);
      setCustom(Number.isFinite(fallback) ? String(fallback) : "");
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setCustom(String(clamped));
    onCommit(clamped);
  };

  const inputClassName =
    "h-8 min-w-0 flex-1 rounded border border-input bg-white px-1 text-xs outline-none focus:border-primary disabled:opacity-45";

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <select
        aria-label={ariaLabel}
        disabled={disabled}
        className="h-8 w-[74px] rounded border border-input bg-white px-1 text-xs"
        value={isPreset ? value : "__custom"}
        onChange={(event) => {
          if (event.target.value === "__custom") return;
          commit(event.target.value);
        }}
      >
        {sizes.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
        <option value="__custom">自定义</option>
      </select>
      <span className="inline-flex items-center gap-0.5">
        <input
          aria-label="自定义字号"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          disabled={disabled}
          value={custom}
          className={cn(inputClassName, "w-[64px] text-center tabular-nums")}
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit(custom);
            }
          }}
          onBlur={() => {
            if (custom.trim() !== String(Number.parseInt(value, 10))) commit(custom);
          }}
        />
        <span className="text-[11px] text-muted-foreground">px</span>
      </span>
    </span>
  );
}
