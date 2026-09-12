import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** 输入框里的字号文本 → 数字；允许 "16"、"16px"、" 16 px "。 */
function parseSize(text: string): number | null {
  const match = /^(\d{1,4})\s*(?:px)?$/iu.exec(text.trim());
  if (!match) return null;
  return Number.parseInt(match[1]!, 10);
}

/**
 * 字号控件：**一个可输入的框 + 一个下箭头**。
 *
 * 直接在框里填数字（16、400、512）即可；点下箭头从预设里挑。没有单独的下拉框，
 * 也没有第二个输入框——两处输入是同一件事的两个入口，只留一个。
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
  /** 自定义输入允许的区间，超出会被收窄。 */
  min: number;
  max: number;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  /** 提交回调；入参是归一化后的 px 值。 */
  onCommit: (size: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  // 外部值变化（切选区、选中预设、撤销重做）时同步显示。
  useEffect(() => {
    setDraft(value);
    setOpen(false);
  }, [value]);

  // 点面板外部或按 Esc 关闭。
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const commit = (text: string) => {
    const parsed = parseSize(text);
    if (parsed === null) {
      setDraft(value); // 无法解析就回滚显示，不写入正文
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(`${clamped}px`);
    onCommit(clamped);
  };

  return (
    <span ref={rootRef} className={cn("relative inline-flex", className)}>
      <span className="inline-flex h-8 items-stretch overflow-hidden rounded border border-input bg-white focus-within:border-primary">
        <input
          aria-label={ariaLabel}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          className="h-8 w-[68px] min-w-0 bg-white px-1.5 text-center text-xs tabular-nums outline-none disabled:opacity-45"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit(draft);
            } else if (event.key === "Escape") {
              setDraft(value);
              setOpen(false);
            }
          }}
          onBlur={() => {
            if (draft !== value) commit(draft);
          }}
        />
        <button
          type="button"
          aria-label={`${ariaLabel}预设`}
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen((previous) => !previous)}
          className="grid w-5 place-items-center border-l border-input text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-45"
        >
          <ChevronDown size={12} aria-hidden="true" />
        </button>
      </span>
      {open ? (
        <span
          role="listbox"
          aria-label={`${ariaLabel}预设列表`}
          className="absolute top-[calc(100%+4px)] left-0 z-[70] max-h-[260px] w-[86px] overflow-y-auto rounded-md border border-border bg-white p-1 shadow-xl"
        >
          {sizes.map((size) => {
            const numeric = Number.parseInt(size, 10);
            const active = numeric === Number.parseInt(value, 10);
            return (
              <button
                key={size}
                type="button"
                role="option"
                aria-selected={active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(size)}
                className={cn(
                  "block w-full rounded px-2 py-1 text-left text-xs tabular-nums",
                  active ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted",
                )}
              >
                {size}
              </button>
            );
          })}
        </span>
      ) : null}
    </span>
  );
}
