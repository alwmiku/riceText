import type { Editor } from "@tiptap/react";
import {
  Bold,
  Eraser,
  Italic,
  List,
  ListOrdered,
  Palette,
  Underline as UnderlineIcon,
} from "lucide-react";
import type { MouseEvent } from "react";
import { IconButton } from "../../components/ui";
import { cmd } from "./commands";
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
} from "./editor-actions";
import {
  FONT_FAMILIES,
  FONT_SIZES,
  TOOLBAR_COLORS,
} from "./editor-tool-definitions";

export type FloatingPosition = { x: number; y: number } | null;

function preventSelectionLoss(event: MouseEvent<HTMLElement>) {
  event.preventDefault();
}

function selectionMenuPosition(editor: Editor): FloatingPosition {
  const nativeSelection = window.getSelection();
  if (nativeSelection?.rangeCount) {
    const rect = nativeSelection.getRangeAt(0).getBoundingClientRect();
    if (rect.width || rect.height) {
      return {
        x: Math.min(
          Math.max(rect.left + rect.width / 2, 184),
          window.innerWidth - 184,
        ),
        y: Math.max(rect.top, 10),
      };
    }
  }

  try {
    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    if (Number.isFinite(coords.left) && Number.isFinite(coords.top)) {
      return {
        x: Math.min(Math.max(coords.left, 184), window.innerWidth - 184),
        y: Math.max(coords.top, 10),
      };
    }
  } catch {
    // jsdom and some IME selection states do not expose usable coordinates.
  }

  return {
    x: Math.min(Math.max(window.innerWidth / 2, 184), window.innerWidth - 184),
    y: 80,
  };
}

/** 移动端优先把格式菜单放在选区附近；选区太靠近顶部时改到选区下方，避免被裁掉。 */
function mobileSelectionMenuPosition(editor: Editor): FloatingPosition {
  const position = selectionMenuPosition(editor) ?? {
    x: Math.min(Math.max(window.innerWidth / 2, 184), window.innerWidth - 184),
    y: 80,
  };
  const nativeSelection = window.getSelection();
  let selectionBottom = 80;
  if (nativeSelection?.rangeCount) {
    const rect = nativeSelection.getRangeAt(0).getBoundingClientRect();
    if (rect.width || rect.height) selectionBottom = rect.bottom;
  }
  if (position.y < 220) {
    return {
      x: position.x,
      y: Math.min(selectionBottom + 8, Math.max(window.innerHeight - 8, 8)),
    };
  }
  return position;
}

function FormatControls({ editor }: { editor: Editor }) {
  const spoilerActive = editor.isActive("spoiler");
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
        <div
          className="flex min-h-[30px] items-center gap-[3px] border-x border-[#e3e3e3] px-1 text-[#4c5660]"
          aria-label="选区文字颜色"
        >
          <Palette size={14} aria-hidden="true" />
          {TOOLBAR_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`文字颜色 ${color}`}
              aria-pressed={textStyle.color === color}
              className="h-[18px] w-[18px] rounded-[3px] border-2 border-transparent shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)] aria-pressed:border-[#197c73] aria-pressed:shadow-[0_0_0_2px_rgb(25_124_115/0.2)]"
              style={{ background: color }}
              disabled={spoilerActive}
              onMouseDown={preventSelectionLoss}
              onClick={() => setColor(editor, color)}
            />
          ))}
        </div>
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
 * 选区浮动格式工具栏（桌面与移动端两套样式）。
 * 位置在渲染期按当前 DOM 选区计算：selectionUpdate/transaction 触发
 * 的父级重渲染会自然刷新坐标，无需额外订阅。
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
  const position = mobile
    ? mobileSelectionMenuPosition(editor)
    : selectionMenuPosition(editor);
  if (!position) return null;

  if (mobile) {
    return (
      <div
        className="fixed z-[60] w-max max-w-[calc(100vw-16px)] overflow-visible rounded-lg border border-border bg-white/[0.98] p-1.5 shadow-[0_8px_24px_rgb(15_23_42/0.18)] -translate-x-1/2 -translate-y-[calc(100%+8px)] [&_.flex]:overflow-x-auto [&_.flex]:[scrollbar-width:none] [&_.flex::-webkit-scrollbar]:hidden [&_select:first-of-type]:w-[min(132px,36vw)] [&_select:nth-of-type(2)]:w-[74px]"
        role="toolbar"
        aria-label="选区格式菜单"
        style={{ left: position.x, top: position.y }}
      >
        <FormatControls editor={editor} />
      </div>
    );
  }

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
