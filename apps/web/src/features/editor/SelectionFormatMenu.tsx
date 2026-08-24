import type { Editor } from "@tiptap/react";
import {
  AtSign,
  Bold,
  ChevronRight,
  Dice5,
  Eraser,
  FileText,
  ImagePlus,
  Italic,
  MoreHorizontal,
  Palette,
  Redo2,
  TextQuote,
  Underline as UnderlineIcon,
  Undo2,
  Vote,
} from "lucide-react";
import { useEffect, useReducer, useState, type MouseEvent, type ReactNode } from "react";
import { IconButton } from "../../components/ui";

const colors = ["#20272c", "#197c73", "#b66a0a", "#b63434", "#6b4bb5"];
const fontSizes = ["14px", "16px", "18px", "20px", "24px", "28px"];
const fonts = [
  { value: "", label: "默认字体" },
  { value: "sans-serif", label: "黑体" },
  { value: "Noto Serif SC", label: "宋体" },
  { value: "monospace", label: "等宽" },
];

type MenuPosition = { x: number; y: number } | null;
type FloatingPosition = { x: number; y: number } | null;

function selectedText(editor: Editor | null): string {
  if (!editor || editor.state.selection.empty) return "";
  return editor.state.doc.textBetween(
    editor.state.selection.from,
    editor.state.selection.to,
    " ",
  );
}

function preventSelectionLoss(event: MouseEvent<HTMLElement>) {
  event.preventDefault();
}

function FormatControls({ editor }: { editor: Editor }) {
  const spoilerActive = editor.isActive("spoiler");
  const textStyle = editor.getAttributes("textStyle") as {
    color?: string;
    fontSize?: string;
    fontFamily?: string;
  };
  const run = (action: (value: Editor) => boolean) => () => action(editor);

  return (
    <div className="selection-format-controls">
      <div className="selection-format-row" aria-label="文字样式">
        <IconButton
          label="加粗"
          active={editor.isActive("bold")}
          disabled={spoilerActive}
          onMouseDown={preventSelectionLoss}
          onClick={run((value) => value.chain().focus().toggleBold().run())}
        >
          <Bold size={16} />
        </IconButton>
        <IconButton
          label="斜体"
          active={editor.isActive("italic")}
          disabled={spoilerActive}
          onMouseDown={preventSelectionLoss}
          onClick={run((value) => value.chain().focus().toggleItalic().run())}
        >
          <Italic size={16} />
        </IconButton>
        <IconButton
          label="下划线"
          active={editor.isActive("underline")}
          onMouseDown={preventSelectionLoss}
          onClick={run((value) => value.chain().focus().toggleUnderline().run())}
        >
          <UnderlineIcon size={16} />
        </IconButton>
        <IconButton
          label="清除样式"
          onMouseDown={preventSelectionLoss}
          onClick={run((value) =>
            value.chain().focus().unsetAllMarks().clearNodes().run(),
          )}
        >
          <Eraser size={16} />
        </IconButton>
      </div>
      <label className="selection-format-field">
        <span>字体</span>
        <select
          aria-label="选区字体"
          disabled={spoilerActive}
          value={textStyle.fontFamily ?? ""}
          onChange={(event) => {
            const chain = editor.chain().focus();
            if (event.target.value) chain.setFontFamily(event.target.value).run();
            else chain.unsetFontFamily().run();
          }}
        >
          {fonts.map((font) => (
            <option key={font.value} value={font.value}>
              {font.label}
            </option>
          ))}
        </select>
      </label>
      <label className="selection-format-field">
        <span>字号</span>
        <select
          aria-label="选区字号"
          disabled={spoilerActive}
          value={textStyle.fontSize ?? "16px"}
          onChange={(event) =>
            editor
              .chain()
              .focus()
              .setMark("textStyle", {
                ...editor.getAttributes("textStyle"),
                fontSize: event.target.value,
              })
              .run()
          }
        >
          {fontSizes.map((fontSize) => (
            <option key={fontSize}>{fontSize}</option>
          ))}
        </select>
      </label>
      <div className="selection-color-group" aria-label="选区文字颜色">
        <Palette size={15} aria-hidden="true" />
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`文字颜色 ${color}`}
            aria-pressed={textStyle.color === color}
            className="selection-color-swatch"
            style={{ background: color }}
            disabled={spoilerActive}
            onMouseDown={preventSelectionLoss}
            onClick={() => editor.chain().focus().setColor(color).run()}
          />
        ))}
      </div>
    </div>
  );
}

function ContextInsertSubmenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const insertItems = [
    { tool: "image", label: "图片", icon: ImagePlus },
    { tool: "dice", label: "骰子", icon: Dice5 },
    { tool: "attachment", label: "附件", icon: FileText },
    { tool: "mention", label: "提及用户", icon: AtSign },
    { tool: "poll", label: "投票", icon: Vote },
    { tool: "excerpt", label: "小说摘录", icon: TextQuote },
  ] as const;

  return (
    <div
      className="selection-context-submenu"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="selection-context-submenu__trigger"
        aria-expanded={open}
        onMouseDown={preventSelectionLoss}
        onClick={() => setOpen((value) => !value)}
      >
        插入内容
        <ChevronRight size={16} />
      </button>
      {open ? (
        <div className="selection-context-submenu__content" role="menu" aria-label="插入内容">
          {insertItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.tool}
                type="button"
                className="selection-context-submenu__item"
                onMouseDown={preventSelectionLoss}
                onClick={() => {
                  document.dispatchEvent(
                    new CustomEvent("ricetext:context-insert", {
                      detail: { editor, tool: item.tool },
                    }),
                  );
                  setOpen(false);
                }}
              >
                <Icon size={15} />
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function EditorContextActions({ editor }: { editor: Editor }) {
  if (!editor.state.selection.empty)
    return (
      <div className="selection-context-stack">
        <FormatControls editor={editor} />
        <ContextInsertSubmenu editor={editor} />
      </div>
    );

  return (
    <div className="selection-context-actions" aria-label="编辑命令">
      <IconButton
        label="撤销"
        disabled={!editor.can().undo()}
        onMouseDown={preventSelectionLoss}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 size={16} />
      </IconButton>
      <IconButton
        label="重做"
        disabled={!editor.can().redo()}
        onMouseDown={preventSelectionLoss}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 size={16} />
      </IconButton>
      <button
        type="button"
        className="selection-context-command"
        onMouseDown={preventSelectionLoss}
        onClick={() => editor.chain().focus().selectAll().run()}
      >
        全选
      </button>
      <ContextInsertSubmenu editor={editor} />
    </div>
  );
}

/** Text-selection actions for desktop context menus and the mobile selection tray. */
export function SelectionFormatMenu({
  editor,
  mobile = false,
  children,
}: {
  editor: Editor | null;
  mobile?: boolean;
  children: ReactNode;
}) {
  const [, rerender] = useReducer((value: number) => value + 1, 0);
  const [position, setPosition] = useState<MenuPosition>(null);
  const [floatingPosition, setFloatingPosition] = useState<FloatingPosition>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const text = selectedText(editor);
  const hasSelection = Boolean(text.trim());

  useEffect(() => {
    if (!editor) return undefined;
    const update = () => {
      rerender();
      if (mobile || editor.state.selection.empty || !selectedText(editor).trim()) {
        setFloatingPosition(null);
        return;
      }
      const nativeSelection = window.getSelection();
      if (!nativeSelection?.rangeCount) {
        setFloatingPosition(null);
        return;
      }
      const rect = nativeSelection.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      setFloatingPosition({
        x: Math.min(Math.max(rect.left + rect.width / 2, 184), window.innerWidth - 184),
        y: Math.max(rect.top, 10),
      });
    };
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".selection-context-menu")) return;
      setPosition(null);
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    document.addEventListener("pointerdown", close);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      document.removeEventListener("pointerdown", close);
    };
  }, [editor, mobile]);

  useEffect(() => {
    if (hasSelection) return;
    setPosition(null);
    setFloatingPosition(null);
    setMobileOpen(false);
  }, [hasSelection]);

  return (
    <div
      className="editor-selection-target"
      onContextMenu={(event) => {
        if (mobile || !editor) return;
        event.preventDefault();
        setPosition({ x: event.clientX, y: event.clientY });
      }}
    >
      {children}
      {editor && !mobile && hasSelection && floatingPosition && !position ? (
        <div
          className="selection-floating-menu"
          role="toolbar"
          aria-label="选区浮动工具栏"
          style={{ left: floatingPosition.x, top: floatingPosition.y }}
        >
          <FormatControls editor={editor} />
        </div>
      ) : null}
      {editor && mobile && hasSelection ? (
        <>
          <div className="mobile-selection-tray" aria-label="已选择的内容">
            <span className="mobile-selection-tray__text">{text}</span>
            <IconButton
              label="选区更多格式"
              active={mobileOpen}
              onMouseDown={preventSelectionLoss}
              onClick={() => setMobileOpen((open) => !open)}
            >
              <MoreHorizontal size={19} />
            </IconButton>
          </div>
          {mobileOpen ? (
            <div className="mobile-selection-menu" role="dialog" aria-label="选区格式菜单">
              <FormatControls editor={editor} />
            </div>
          ) : null}
        </>
      ) : null}
      {editor && !mobile && position ? (
        <div
          className="selection-context-menu"
          role="menu"
          aria-label={hasSelection ? "选区格式菜单" : "编辑上下文菜单"}
          style={{ left: position.x, top: position.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <EditorContextActions editor={editor} />
        </div>
      ) : null}
    </div>
  );
}
