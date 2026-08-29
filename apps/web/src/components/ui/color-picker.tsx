import {
  Check,
  Palette,
  Plus,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { Button } from "../ui";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Slider } from "./slider";

/* ────────────────────────────────────────────────────────────────────────
 * 颜色工具函数（纯函数，独立可测）
 * ──────────────────────────────────────────────────────────────────────── */

export interface HsvColor {
  /** 色相 0-360 */
  h: number;
  /** 饱和度 0-1 */
  s: number;
  /** 明度 0-1 */
  v: number;
}

const HEX6_RE = /^#[0-9a-f]{6}$/u;
const HEX8_RE = /^#[0-9a-f]{8}$/u;

/** 把任意可解析的 CSS 颜色归一化为 #rrggbb / #rrggbbaa；解析失败返回 fallback。 */
export function normalizeHex(value: string, fallback = "#20272c"): string {
  const text = value.trim().toLowerCase();
  if (HEX6_RE.test(text) || HEX8_RE.test(text)) return text;
  const short = text.match(/^#([0-9a-f]{3})$/u);
  if (short) {
    return "#" + short[1]!.split("").map((d) => d + d).join("");
  }
  const rgb = text.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+%?))?\s*\)$/u);
  if (rgb) {
    const channels = [rgb[1], rgb[2], rgb[3]].map((channel) => {
      const n = Number(channel);
      return n <= 255 ? n : 255;
    });
    const alpha = rgb[4] === undefined ? 1 : parseAlpha(rgb[4]);
    return withAlpha(rgbToHex(channels[0]!, channels[1]!, channels[2]!), alpha);
  }
  return fallback;
}

function parseAlpha(value: string): number {
  if (value.endsWith("%")) {
    return Math.min(100, Math.max(0, Number(value.slice(0, -1)))) / 100;
  }
  const n = Number(value);
  return n <= 1 ? Math.min(1, Math.max(0, n)) : Math.min(1, n / 100);
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

function hexToRgb(hex6: string): [number, number, number] {
  const text = hex6.replace(/^#/u, "");
  return [
    Number.parseInt(text.slice(0, 2), 16),
    Number.parseInt(text.slice(2, 4), 16),
    Number.parseInt(text.slice(4, 6), 16),
  ];
}

/** #rrggbb / #rrggbbaa → HSV。 */
export function hexToHsv(hex: string): HsvColor {
  const [r, g, b] = hexToRgb(normalizeHex(hex, "#000000"));
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r / 255) h = ((g - b) / 255 / delta) % 6;
    else if (max === g / 255) h = (b - r) / 255 / delta + 2;
    else h = (r - g) / 255 / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

/** HSV → #rrggbb。 */
export function hsvToHex(h: number, s: number, v: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(1, Math.max(0, s));
  const val = Math.min(1, Math.max(0, v));
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgbToHex(
    Math.round((rgb[0] + m) * 255),
    Math.round((rgb[1] + m) * 255),
    Math.round((rgb[2] + m) * 255),
  );
}

/** 拆分出 6 位色值与透明度（0-1）。 */
export function splitAlpha(hex: string): { hex6: string; alpha: number } {
  const normalized = normalizeHex(hex, "#20272c");
  if (HEX8_RE.test(normalized)) {
    const alpha = Number.parseInt(normalized.slice(7, 9), 16) / 255;
    return { hex6: normalized.slice(0, 7), alpha };
  }
  return { hex6: normalized, alpha: 1 };
}

/** 透明度 1 时输出 6 位 hex，否则输出 8 位 hex（与 sanitizeColor 白名单一致）。 */
export function withAlpha(hex6: string, alpha: number): string {
  const normalized = normalizeHex(hex6, "#20272c");
  const a = Math.min(1, Math.max(0, alpha));
  if (a >= 1) return normalized;
  const alphaByte = Math.round(a * 255).toString(16).padStart(2, "0");
  return normalized + alphaByte;
}

/** Hex 输入框的合法中间态：3/6/8 位（可带 #）。 */
export function isValidHexInput(text: string): boolean {
  const digits = text.trim().replace(/^#/u, "");
  return /^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/u.test(digits);
}

/* ────────────────────────────────────────────────────────────────────────
 * 已存颜色（localStorage 持久化）
 * ──────────────────────────────────────────────────────────────────────── */

const SAVED_COLORS_KEY = "ricetext:saved-colors";
const MAX_SAVED_COLORS = 8;

/** 首次使用时的默认已存颜色（刻意保持少量，与设计稿一致）。 */
export const DEFAULT_SAVED_COLORS = [
  "#20272c",
  "#197c73",
  "#b66a0a",
  "#b63434",
  "#4f46e5",
];


function loadSavedColors(): string[] {
  try {
    const raw = window.localStorage.getItem(SAVED_COLORS_KEY);
    if (!raw) return [...DEFAULT_SAVED_COLORS];
    const parsed: unknown = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_SAVED_COLORS];
    const colors = parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => normalizeHex(item))
      .filter((item, index, all) => all.indexOf(item) === index);
    return colors.length > 0 ? colors : [...DEFAULT_SAVED_COLORS];
  } catch {
    return [...DEFAULT_SAVED_COLORS];
  }
}

function persistSavedColors(colors: string[]): void {
  try {
    window.localStorage.setItem(SAVED_COLORS_KEY, JSON.stringify(colors));
  } catch {
    // localStorage 不可用（隐私模式/配额）时静默降级为仅内存。
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}


/* ────────────────────────────────────────────────────────────────────────
 * 拾色器组件
 * ──────────────────────────────────────────────────────────────────────── */

export interface ColorPickerProps {
  /** 当前颜色，任意可解析的 CSS 颜色；不可解析时回退默认色。 */
  value: string;
  /** 颜色变化回调，产出 #rrggbb 或 #rrggbbaa。 */
  onChange: (color: string) => void;
  /** 紧凑模式（移动端）：仅保留色板、Hex 输入与透明度，省略取色面板。 */
  compact?: boolean;
  disabled?: boolean;
  className?: string;
}

/** shadcn 风格拾色器：SV 面板、色相/透明度滑杆（Radix Slider）、Hex 输入与已存颜色。 */
export function ColorPicker({
  value,
  onChange,
  compact = false,
  disabled = false,
  className,
}: ColorPickerProps) {
  const parsed = splitAlpha(value);
  const [draft, setDraft] = useState<{ hex6: string; alpha: number }>(parsed);
  const [hexText, setHexText] = useState(parsed.hex6);
  const [saved, setSaved] = useState<string[]>(loadSavedColors);
  const svRef = useRef<HTMLDivElement>(null);
  const [svDragging, setSvDragging] = useState(false);

  /** SV 面板为二维取色，Radix Slider 无法表达，按指针坐标直接换算饱和度/明度。 */
  const updateSv = (clientX: number, clientY: number) => {
    const rect = svRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const s = clamp01((clientX - rect.left) / rect.width);
    const v = clamp01(1 - (clientY - rect.top) / rect.height);
    commit(hsvToHex(hsv.h, s, v), draft.alpha);
  };

  // 外部 value 变化（编辑器撤销/重做、外部 setColor）时同步草稿。
  useEffect(() => {
    const next = splitAlpha(value);
    setDraft(next);
    setHexText(next.hex6);
  }, [value]);

  const commit = (hex6: string, alpha: number) => {
    const next = { hex6: normalizeHex(hex6), alpha: clamp01(alpha) };
    setDraft(next);
    setHexText(next.hex6);
    onChange(withAlpha(next.hex6, next.alpha));
  };

  const hsv = hexToHsv(draft.hex6);
  const current = withAlpha(draft.hex6, draft.alpha);

  const addSaved = () => {
    setSaved((previous) => {
      const next = [
        current,
        ...previous.filter((item) => normalizeHex(item) !== current),
      ].slice(0, MAX_SAVED_COLORS);
      persistSavedColors(next);
      return next;
    });
  };

  const pickSaved = (color: string) => {
    const { hex6, alpha } = splitAlpha(color);
    commit(hex6, alpha);
  };

  const commitHexText = () => {
    const clean = hexText.trim().replace(/^#/u, "").toLowerCase();
    if (/^[0-9a-f]{6}$/u.test(clean)) {
      commit("#" + clean, draft.alpha);
      return;
    }
    if (/^[0-9a-f]{8}$/u.test(clean)) {
      const { hex6, alpha } = splitAlpha("#" + clean);
      commit(hex6, alpha);
      return;
    }
    setHexText(draft.hex6);
  };

  const swatchLabel = (color: string) => `文字颜色 ${color}`;

  return (
    <div
      role="group"
      aria-label="拾色器"
      className={cn(
        "flex flex-col gap-2",
        compact ? "w-56" : "w-[236px]",
        className,
      )}
    >
      {!compact && (
        <>
          {/* 饱和度 / 明度面板 */}
          <div
            ref={svRef}
            role="slider"
            aria-label="饱和度与亮度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsv.s * 100)}
            tabIndex={disabled ? -1 : 0}
            className="relative h-36 w-full touch-none select-none overflow-hidden rounded-md border border-border"
            style={{
              background: `linear-gradient(to top, #000, rgb(0 0 0 / 0)), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`,
            }}
            onPointerDown={(event) => {
              if (disabled) return;
              if (event.pointerType === "mouse" && event.button !== 0) return;
              event.preventDefault();
              try {
                svRef.current?.setPointerCapture(event.pointerId);
              } catch {
                // 指针捕获失败（例如测试环境）时退化为仅按下时更新。
              }
              setSvDragging(true);
              updateSv(event.clientX, event.clientY);
            }}
            onPointerMove={(event) => {
              if (svDragging) updateSv(event.clientX, event.clientY);
            }}
            onPointerUp={() => setSvDragging(false)}
            onPointerCancel={() => setSvDragging(false)}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 0.1 : 0.02;
              let s = hsv.s;
              let v = hsv.v;
              if (event.key === "ArrowLeft") s -= step;
              else if (event.key === "ArrowRight") s += step;
              else if (event.key === "ArrowUp") v += step;
              else if (event.key === "ArrowDown") v -= step;
              else return;
              event.preventDefault();
              commit(hsvToHex(hsv.h, s, v), draft.alpha);
            }}
          >
            <div
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35)]"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
            />
          </div>

          {/* 色相滑杆（Radix Slider） */}
          <Slider
            aria-label="色相"
            thumbAriaLabel="色相"
            min={0}
            max={360}
            step={1}
            value={[hsv.h]}
            disabled={disabled}
            showRange={false}
            trackStyle={{
              background:
                "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
            }}
            onValueChange={([hue]) => {
              if (hue === undefined) return;
              commit(hsvToHex(hue, hsv.s, hsv.v), draft.alpha);
            }}
          />

          {/* 透明度滑杆（Radix Slider） */}
          <Slider
            aria-label="透明度"
            thumbAriaLabel="透明度"
            min={0}
            max={100}
            step={1}
            value={[Math.round(draft.alpha * 100)]}
            disabled={disabled}
            rangeClassName="bg-white/40"
            trackStyle={{
              background: `linear-gradient(to right, rgb(0 0 0 / 0), ${draft.hex6}), repeating-conic-gradient(#e5e7eb 0% 25%, #fff 0% 50%) 0 0 / 10px 10px`,
            }}
            onValueChange={([percent]) => {
              if (percent === undefined) return;
              commit(draft.hex6, percent / 100);
            }}
          />
        </>
      )}

      {/* Hex 输入与透明度读数 */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-muted-foreground">Hex</span>
        <Input
          aria-label="Hex 色值"
          value={hexText}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          className="h-7 w-[104px] font-mono text-xs uppercase"
          onChange={(event) => setHexText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitHexText();
            } else if (event.key === "Escape") {
              setHexText(draft.hex6);
            } else if (event.key !== "Tab") {
              // 阻止 Radix 菜单的键盘导航/类型查找拦截输入。
              event.stopPropagation();
            }
          }}
          onBlur={commitHexText}
        />
        <span
          aria-label="透明度读数"
          className="ml-auto text-xs tabular-nums text-muted-foreground"
        >
          {Math.round(draft.alpha * 100)}%
        </span>
      </div>

      {compact && (
        <Slider
          aria-label="透明度"
          thumbAriaLabel="透明度"
          min={0}
          max={100}
          step={1}
          value={[Math.round(draft.alpha * 100)]}
          disabled={disabled}
          rangeClassName="bg-white/40"
          trackStyle={{
            background: `linear-gradient(to right, rgb(0 0 0 / 0), ${draft.hex6}), repeating-conic-gradient(#e5e7eb 0% 25%, #fff 0% 50%) 0 0 / 10px 10px`,
          }}
          onValueChange={([percent]) => {
            if (percent === undefined) return;
            commit(draft.hex6, percent / 100);
          }}
        />
      )}

      {!compact && (
        <>

          {/* 已存颜色 */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">
              已存颜色
            </span>
            <button
              type="button"
              aria-label="添加当前颜色"
              disabled={disabled}
              onClick={addSaved}
              className="ml-auto inline-flex items-center gap-0.5 rounded border border-input px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-45"
            >
              <Plus size={11} />
              添加
            </button>
          </div>
        </>
      )}

      {/* 已存颜色（紧凑模式为唯一快速选择区） */}
      <div
        aria-label="已存颜色色板"
        className={cn(
          "flex items-center gap-1.5",
          compact && "overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {saved.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={swatchLabel(color)}
            aria-pressed={normalizeHex(current) === color}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => pickSaved(color)}
            className={cn(
              "shrink-0 rounded-full border border-black/10 disabled:pointer-events-none disabled:opacity-45",
              compact ? "size-7" : "size-6",
            )}
            style={{ background: color }}
          >
            {normalizeHex(current) === color && (
              <Check size={compact ? 14 : 12} className="mx-auto text-white drop-shadow-[0_0_1px_rgb(0_0_0/0.8)]" aria-hidden="true" />
            )}
          </button>
        ))}
        {compact && (
          <label
            aria-label="系统取色器"
            title="系统取色器"
            className="ml-auto inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded border border-input text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-45"
          >
            <input
              type="color"
              aria-hidden="true"
              tabIndex={-1}
              disabled={disabled}
              value={draft.hex6}
              onChange={(event) => {
                const { hex6, alpha } = splitAlpha(event.target.value);
                commit(hex6, alpha);
              }}
              className="sr-only"
            />
            <Palette size={14} aria-hidden="true" />
          </label>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * 工具栏弹层包装
 * ──────────────────────────────────────────────────────────────────────── */

export interface ColorPickerPopoverProps extends ColorPickerProps {
  /** 触发按钮的可访问名称（默认「文字颜色」）。 */
  label?: string;
  /** 触发按钮的自定义内容（默认显示当前颜色色块）。 */
  triggerChildren?: ReactNode;
  /** 触发按钮的 className。 */
  triggerClassName?: string;
  /** 触发按钮 onMouseDown，用于在选区浮动工具栏中保持编辑器选区。 */
  triggerOnMouseDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
}

/** 工具栏按钮 + Popover 的一体化拾色器入口，复用 shadcn Popover/Button。 */
export function ColorPickerPopover({
  value,
  onChange,
  compact = false,
  disabled = false,
  label = "文字颜色",
  triggerChildren,
  triggerClassName,
  triggerOnMouseDown,
  align = "start",
  side = "bottom",
  className,
}: ColorPickerPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          aria-label={label}
          disabled={disabled}
          onMouseDown={triggerOnMouseDown}
          className={cn("relative", triggerClassName)}
        >
          {triggerChildren ?? (
            <span
              className="h-4 w-4 rounded-sm border border-black/15"
              style={{ background: value || "#20272c" }}
            />
          )}
        </Button>
      </PopoverTrigger>
      {/* z-[70]：有选区时选区浮动工具栏为 z-[60]，必须在其之上才能接收点击。 */}
      <PopoverContent
        align={align}
        side={side}
        className="z-[70] w-auto p-1.5"
        onInteractOutside={(event) => {
          // setColor 会 focus 编辑器，焦点移出 popover；新版 Radix 把 focusin
          // 也视为 interact outside 而关闭面板，导致滑杆按下即关、无法拖动。
          // 只拦截 focusin 来源的关闭，点击面板外部（pointerdown）仍正常关闭。
          if (event.detail.originalEvent.type === "focusin") {
            event.preventDefault();
          }
        }}
      >
        <ColorPicker
          value={value}
          onChange={onChange}
          compact={compact}
          disabled={disabled}
          {...(className ? { className } : {})}
        />
      </PopoverContent>
    </Popover>
  );
}
