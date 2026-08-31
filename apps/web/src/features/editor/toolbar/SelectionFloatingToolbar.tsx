import type { Editor } from "@tiptap/react";
import {
  Bold,
  Eraser,
  Italic,
  List,
  ListOrdered,
  Underline as UnderlineIcon,
} from "lucide-react";
import { useEffect, useRef, type MouseEvent } from "react";
import { IconButton } from "../../../components/ui";
import {
  ColorPickerPopover,
  useLastColor,
} from "../../../components/ui/color-picker";
import { cmd } from "../commands";
import {
  clearFormatting,
  setColor,
  setFontFamily,
  setFontSize,
  toggleBold,
  toggleBulletList,
  toggleItalic,
  toggleOrderedList,
  toggleUnderline,
} from "../editor-actions";
import { FONT_FAMILIES, FONT_SIZES } from "../editor-tool-definitions";

export type ToolbarPosition = { x: number; y: number };

function preventSelectionLoss(event: MouseEvent<HTMLElement>) {
  event.preventDefault();
}

const clampX = (x: number) =>
  Math.min(Math.max(x, 184), window.innerWidth - 184);

function fallbackSelectionPosition(editor: Editor): ToolbarPosition {
  try {
    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    if (Number.isFinite(coords.left) && Number.isFinite(coords.top)) {
      return {
        x: clampX(coords.left),
        y: Math.max(coords.top, 10),
      };
    }
  } catch {
    // jsdom and some IME selection states do not expose usable coordinates.
  }
  return {
    x: clampX(window.innerWidth / 2),
    y: 80,
  };
}

/**
 * 读取编辑器 DOM 内的原生选区矩形。选区不在编辑器内（例如焦点落在
 * 链接/图片对话框的输入框上）或不可用时返回 null，避免浮动工具栏
 * 按浏览器选区跳到错误位置，此时退回 ProseMirror 选区坐标。
 */
function nativeSelectionRect(editor: Editor): DOMRect | null {
  const nativeSelection = window.getSelection();
  if (!nativeSelection?.rangeCount) return null;
  const range = nativeSelection.getRangeAt(0);
  const container = nativeSelection.anchorNode ?? range.startContainer;
  if (!container || !editor.view.dom.contains(container)) return null;
  const rect = range.getBoundingClientRect();
  return rect.width || rect.height ? rect : null;
}

function selectionMenuPosition(editor: Editor): ToolbarPosition {
  const rect = nativeSelectionRect(editor);
  if (rect) {
    return {
      x: clampX(rect.left + rect.width / 2),
      y: Math.max(rect.top, 10),
    };
  }
  return fallbackSelectionPosition(editor);
}

/** 移动端优先把格式菜单放在选区附近；选区太靠近顶部时改到选区下方，避免被裁掉。 */
function mobileSelectionMenuPosition(editor: Editor): ToolbarPosition {
  const position = selectionMenuPosition(editor) ?? fallbackSelectionPosition(editor);
  let selectionBottom = 80;
  const rect = nativeSelectionRect(editor);
  if (rect) selectionBottom = rect.bottom;
  if (position.y < 220) {
    return {
      x: position.x,
      y: Math.min(selectionBottom + 8, Math.max(window.innerHeight - 8, 8)),
    };
  }
  return position;
}

function FormatControls({
  editor,
  mobile = false,
}: {
  editor: Editor;
  mobile?: boolean;
}) {
  const spoilerActive = editor.isActive("spoiler");
  const lastColor = useLastColor();
  const textStyle = editor.getAttributes("textStyle") as {
    color?: string;
    fontSize?: string;
    fontFamily?: string;
  };

  return (
    <div className="grid gap-1">
      <div
        className="flex min-h-[30px] items-center gap-[3px] [&+&]:border-t [&+&]:border-[#e3e3e3] [&+&]:pt-[3px]"
        aria-label="字体与字号"
      >
        <label className="block [&_span]:hidden">
          <span>字体</span>
          <select
            aria-label="选区字体"
            disabled={spoilerActive}
            value={textStyle.fontFamily ?? ""}
            onChange={(event) => setFontFamily(editor, event.target.value)}
            className="h-[30px] w-[134px] rounded border border-[#9fa5aa] bg-white px-1.5 text-[13px] text-[#1f2933]"
          >
            {FONT_FAMILIES.map((font) => (
              <option key={font.value} value={font.value}>
                {font.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block [&_span]:hidden">
          <span>字号</span>
          <select
            aria-label="选区字号"
            disabled={spoilerActive}
            value={textStyle.fontSize ?? "16px"}
            onChange={(event) => setFontSize(editor, event.target.value)}
            className="h-[30px] w-[78px] rounded border border-[#9fa5aa] bg-white px-1.5 text-[13px] text-[#1f2933]"
          >
            {FONT_SIZES.map((fontSize) => (
              <option key={fontSize}>{fontSize}</option>
            ))}
          </select>
        </label>
        <IconButton
          label="清除样式"
          className="h-[30px] w-[30px] min-h-[30px] min-w-[30px] rounded"
          onMouseDown={preventSelectionLoss}
          onClick={cmd(editor, clearFormatting)}
        >
          <Eraser size={15} />
        </IconButton>
      </div>
      <div
        className="flex min-h-[30px] items-center gap-[3px] [&+&]:border-t [&+&]:border-[#e3e3e3] [&+&]:pt-[3px]"
        aria-label="文字样式"
      >
        <IconButton
          label="加粗"
          active={editor.isActive("bold")}
          className="h-[30px] w-[30px] min-h-[30px] min-w-[30px] rounded"
          disabled={spoilerActive}
          onMouseDown={preventSelectionLoss}
          onClick={cmd(editor, toggleBold)}
        >
          <Bold size={15} />
        </IconButton>
        <IconButton
          label="斜体"
          active={editor.isActive("italic")}
          className="h-[30px] w-[30px] min-h-[30px] min-w-[30px] rounded"
          disabled={spoilerActive}
          onMouseDown={preventSelectionLoss}
          onClick={cmd(editor, toggleItalic)}
        >
          <Italic size={15} />
        </IconButton>
        <IconButton
          label="下划线"
          active={editor.isActive("underline")}
          className="h-[30px] w-[30px] min-h-[30px] min-w-[30px] rounded"
          onMouseDown={preventSelectionLoss}
          onClick={cmd(editor, toggleUnderline)}
        >
          <UnderlineIcon size={15} />
        </IconButton>
        {mobile ? (
          // 移动端悬浮工具栏空间紧张：与桌面一致的「色块 + 箭头」紧凑入口，
          // 点色块直接应用，箭头展开色板面板。
          <ColorPickerPopover
            onChange={(color) => setColor(editor, color)}
            label="选区文字颜色"
            swatchLabel="应用选区文字颜色"
            disabled={spoilerActive}
            align="center"
            side="top"
            saturationCompact
            triggerClassName="h-[26px] rounded"
            triggerOnMouseDown={preventSelectionLoss}
          />
        ) : (
          <ColorPickerPopover
            onChange={(color) => setColor(editor, color)}
            label="选区文字颜色"
            swatchLabel="应用选区文字颜色"
            disabled={spoilerActive}
            align="center"
            triggerClassName="h-[30px] rounded"
            triggerChildren={
              <span className="h-3 w-3 rounded-sm border border-black/15" style={{ background: lastColor }} />
            }
            triggerOnMouseDown={preventSelectionLoss}
          />
        )}
        <IconButton
          label="无序列表"
          active={editor.isActive("bulletList")}
          className="h-[30px] w-[30px] min-h-[30px] min-w-[30px] rounded"
          onMouseDown={preventSelectionLoss}
          onClick={cmd(editor, toggleBulletList)}
        >
          <List size={15} />
        </IconButton>
        <IconButton
          label="有序列表"
          active={editor.isActive("orderedList")}
          className="h-[30px] w-[30px] min-h-[30px] min-w-[30px] rounded"
          onMouseDown={preventSelectionLoss}
          onClick={cmd(editor, toggleOrderedList)}
        >
          <ListOrdered size={15} />
        </IconButton>
      </div>
    </div>
  );
}

/**
 * 移动端选区浮动格式工具栏。
 *
 * Android 拖动选区手柄期间浏览器不派发 selectionchange/selectionUpdate，
 * 渲染期坐标会在旧选区处冻结：这里用 rAF 轮询原生选区矩形并通过 ref
 * 直接写 left/top（不触发 React 渲染），让工具栏实时贴住移动中的选区，
 * 同时覆盖选区拖动时的自动滚动；没有 rAF 的环境（jsdom/旧浏览器）回退为
 * 66ms 定时器。选区在编辑器之外（如对话框输入框）时退回 ProseMirror 坐标。
 */
function MobileSelectionFloatingToolbar({
  editor,
  position,
}: {
  editor: Editor;
  position: ToolbarPosition;
}) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = toolbarRef.current;
    if (!element) return undefined;
    let frame = 0;
    let lastX = Number.NaN;
    let lastY = Number.NaN;
    const apply = () => {
      const next = mobileSelectionMenuPosition(editor);
      if (next && (next.x !== lastX || next.y !== lastY)) {
        lastX = next.x;
        lastY = next.y;
        element.style.left = `${next.x}px`;
        element.style.top = `${next.y}px`;
      }
      frame =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame(apply)
          : (window.setTimeout(apply, 66) as unknown as number);
    };
    frame =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(apply)
        : (window.setTimeout(apply, 66) as unknown as number);
    return () => {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      else window.clearTimeout(frame);
    };
  }, [editor]);

  return (
    <div
      ref={toolbarRef}
      className="fixed z-[60] w-max max-w-[calc(100vw-16px)] overflow-visible rounded-lg border border-border bg-white/[0.98] p-1.5 shadow-[0_8px_24px_rgb(15_23_42/0.18)] -translate-x-1/2 -translate-y-[calc(100%+8px)] [&_.flex]:overflow-x-auto [&_.flex]:[scrollbar-width:none] [&_.flex::-webkit-scrollbar]:hidden [&_select:first-of-type]:w-[min(132px,36vw)] [&_select:nth-of-type(2)]:w-[74px]"
      role="toolbar"
      aria-label="选区格式菜单"
      style={{ left: position.x, top: position.y }}
    >
      <FormatControls editor={editor} mobile />
    </div>
  );
}

/**
 * 选区浮动格式工具栏（桌面与移动端两套样式）。
 * 位置在渲染期按当前 DOM 选区计算：selectionUpdate/transaction 触发
 * 的父级重渲染会自然刷新坐标，无需额外订阅；移动端由
 * {@link MobileSelectionFloatingToolbar} 在选区拖拽期间实时跟踪。
 */
export function SelectionFloatingToolbar({
  editor,
  mobile = false,
  visible,
}: {
  editor: Editor | null;
  mobile?: boolean;
  visible: boolean;
}) {
  if (!editor || !visible) return null;

  if (mobile) {
    const mobilePosition = mobileSelectionMenuPosition(editor);
    return (
      <MobileSelectionFloatingToolbar
        editor={editor}
        position={mobilePosition}
      />
    );
  }

  const position = selectionMenuPosition(editor);

  return (
    <div
      className="fixed z-[60] w-max max-w-[calc(100vw-24px)] overflow-visible rounded-md border border-[#c9c9c9] bg-white/[0.98] p-[5px] shadow-[0_8px_24px_rgb(15_23_42/0.18)] -translate-x-1/2 -translate-y-[calc(100%+8px)]"
      role="toolbar"
      aria-label="选区浮动工具栏"
      style={{ left: position.x, top: position.y }}
    >
      <FormatControls editor={editor} />
    </div>
  );
}
