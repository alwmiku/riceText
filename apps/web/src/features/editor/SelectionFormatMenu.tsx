import type { Editor } from "@tiptap/react";
import {
  AtSign,
  Bold,
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
import {
  useEffect,
  useReducer,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { IconButton } from "../../components/ui";

const colors = ["#20272c", "#197c73", "#b66a0a", "#b63434", "#6b4bb5"];
const fontSizes = ["14px", "16px", "18px", "20px", "24px", "28px"];
const fonts = [
  { value: "", label: "默认字体" },
  { value: "sans-serif", label: "黑体" },
  { value: "Noto Serif SC", label: "宋体" },
  { value: "monospace", label: "等宽" },
];

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
          onClick={run((value) =>
            value.chain().focus().toggleUnderline().run(),
          )}
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
            if (event.target.value)
              chain.setFontFamily(event.target.value).run();
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

function dispatchInsertRequest(editor: Editor, tool: string) {
  window.setTimeout(() => {
    document.dispatchEvent(
      new CustomEvent("ricetext:context-insert", {
        detail: { editor, tool },
      }),
    );
  }, 0);
}

function InsertContentSubmenu({ editor }: { editor: Editor }) {
  const items = [
    { tool: "image", label: "图片", icon: ImagePlus },
    { tool: "dice", label: "骰子", icon: Dice5 },
    { tool: "attachment", label: "附件", icon: FileText },
    { tool: "mention", label: "提及用户", icon: AtSign },
    { tool: "poll", label: "投票", icon: Vote },
    { tool: "excerpt", label: "小说摘录", icon: TextQuote },
  ] as const;

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>插入内容</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <ContextMenuItem
              key={item.tool}
              onSelect={() => dispatchInsertRequest(editor, item.tool)}
            >
              <Icon />
              {item.label}
            </ContextMenuItem>
          );
        })}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function TextFormatSubmenu({ editor }: { editor: Editor }) {
  const spoilerActive = editor.isActive("spoiler");
  const textStyle = editor.getAttributes("textStyle") as {
    color?: string;
    fontSize?: string;
    fontFamily?: string;
  };

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>文字格式</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem
          disabled={spoilerActive}
          onSelect={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold />
          加粗
        </ContextMenuItem>
        <ContextMenuItem
          disabled={spoilerActive}
          onSelect={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic />
          斜体
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon />
          下划线
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() =>
            editor.chain().focus().unsetAllMarks().clearNodes().run()
          }
        >
          <Eraser />
          清除样式
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>字体</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {fonts.map((font) => (
              <ContextMenuItem
                key={font.value}
                disabled={spoilerActive}
                onSelect={() => {
                  const chain = editor.chain().focus();
                  if (font.value) chain.setFontFamily(font.value).run();
                  else chain.unsetFontFamily().run();
                }}
              >
                {font.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>字号</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {fontSizes.map((fontSize) => (
              <ContextMenuItem
                key={fontSize}
                disabled={spoilerActive}
                onSelect={() =>
                  editor
                    .chain()
                    .focus()
                    .setMark("textStyle", {
                      ...editor.getAttributes("textStyle"),
                      fontSize,
                    })
                    .run()
                }
              >
                {fontSize}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>文字颜色</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {colors.map((color) => (
              <ContextMenuItem
                key={color}
                disabled={spoilerActive}
                onSelect={() => editor.chain().focus().setColor(color).run()}
              >
                <span
                  className="h-3 w-3 rounded-sm"
                  style={{ background: color }}
                />
                {color === textStyle.color ? "当前颜色" : color}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function EditorContextItems({
  editor,
  hasSelection,
}: {
  editor: Editor;
  hasSelection: boolean;
}) {
  return (
    <>
      <ContextMenuItem
        disabled={!editor.can().undo()}
        onSelect={() => editor.chain().focus().undo().run()}
      >
        <Undo2 />
        撤销<ContextMenuShortcut>Ctrl+Z</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!editor.can().redo()}
        onSelect={() => editor.chain().focus().redo().run()}
      >
        <Redo2 />
        重做<ContextMenuShortcut>Ctrl+Y</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => editor.chain().focus().selectAll().run()}
      >
        全选<ContextMenuShortcut>Ctrl+A</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      {hasSelection ? <TextFormatSubmenu editor={editor} /> : null}
      <InsertContentSubmenu editor={editor} />
    </>
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
  const [floatingPosition, setFloatingPosition] =
    useState<FloatingPosition>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const text = selectedText(editor);
  const hasSelection = Boolean(text.trim());

  useEffect(() => {
    if (!editor) return undefined;
    const update = () => {
      rerender();
      if (
        mobile ||
        editor.state.selection.empty ||
        !selectedText(editor).trim()
      ) {
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
        x: Math.min(
          Math.max(rect.left + rect.width / 2, 184),
          window.innerWidth - 184,
        ),
        y: Math.max(rect.top, 10),
      });
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor, mobile]);

  useEffect(() => {
    if (hasSelection) return;
    setFloatingPosition(null);
    setMobileOpen(false);
  }, [hasSelection]);

  const content = (
    <div className="editor-selection-target">
      {children}
      {editor && !mobile && hasSelection && floatingPosition ? (
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
            <div
              className="mobile-selection-menu"
              role="dialog"
              aria-label="选区格式菜单"
            >
              <FormatControls editor={editor} />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );

  if (mobile || !editor) return content;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
      <ContextMenuContent
        aria-label={hasSelection ? "选区格式菜单" : "编辑上下文菜单"}
      >
        <EditorContextItems editor={editor} hasSelection={hasSelection} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
