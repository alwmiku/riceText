import type { Editor } from "@tiptap/react";
import {
  AtSign,
  Bold,
  Dice5,
  Eraser,
  FileText,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
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
  const run = (action: (value: Editor) => boolean) => () => action(editor);

  return (
    <div className="grid gap-1">
      <div className="flex min-h-[30px] items-center gap-[3px] [&+&]:border-t [&+&]:border-[#e3e3e3] [&+&]:pt-[3px]" aria-label="字体与字号">
        <label className="block [&_span]:hidden">
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
            className="h-[30px] w-[134px] rounded border border-[#9fa5aa] bg-white px-1.5 text-[13px] text-[#1f2933]"
          >
            {fonts.map((font) => (
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
            className="h-[30px] w-[78px] rounded border border-[#9fa5aa] bg-white px-1.5 text-[13px] text-[#1f2933]"
          >
            {fontSizes.map((fontSize) => (
              <option key={fontSize}>{fontSize}</option>
            ))}
          </select>
        </label>
        <IconButton
          label="清除样式"
          className="h-[30px] w-[30px] min-h-[30px] min-w-[30px] rounded"
          onMouseDown={preventSelectionLoss}
          onClick={run((value) =>
            value.chain().focus().unsetAllMarks().clearNodes().run(),
          )}
        >
          <Eraser size={15} />
        </IconButton>
      </div>
      <div className="flex min-h-[30px] items-center gap-[3px] [&+&]:border-t [&+&]:border-[#e3e3e3] [&+&]:pt-[3px]" aria-label="文字样式">
        <IconButton
          label="加粗"
          active={editor.isActive("bold")}
          className="h-[30px] w-[30px] min-h-[30px] min-w-[30px] rounded"
          disabled={spoilerActive}
          onMouseDown={preventSelectionLoss}
          onClick={run((value) => value.chain().focus().toggleBold().run())}
        >
          <Bold size={15} />
        </IconButton>
        <IconButton
          label="斜体"
          active={editor.isActive("italic")}
          className="h-[30px] w-[30px] min-h-[30px] min-w-[30px] rounded"
          disabled={spoilerActive}
          onMouseDown={preventSelectionLoss}
          onClick={run((value) => value.chain().focus().toggleItalic().run())}
        >
          <Italic size={15} />
        </IconButton>
        <IconButton
          label="下划线"
          active={editor.isActive("underline")}
          className="h-[30px] w-[30px] min-h-[30px] min-w-[30px] rounded"
          onMouseDown={preventSelectionLoss}
          onClick={run((value) =>
            value.chain().focus().toggleUnderline().run(),
          )}
        >
          <UnderlineIcon size={15} />
        </IconButton>
        <div className="flex min-h-[30px] items-center gap-[3px] border-x border-[#e3e3e3] px-1 text-[#4c5660]" aria-label="选区文字颜色">
          <Palette size={14} aria-hidden="true" />
          {colors.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`文字颜色 ${color}`}
              aria-pressed={textStyle.color === color}
              className="h-[18px] w-[18px] rounded-[3px] border-2 border-transparent shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)] aria-pressed:border-[#197c73] aria-pressed:shadow-[0_0_0_2px_rgb(25_124_115/0.2)]"
              style={{ background: color }}
              disabled={spoilerActive}
              onMouseDown={preventSelectionLoss}
              onClick={() => editor.chain().focus().setColor(color).run()}
            />
          ))}
        </div>
        <IconButton
          label="无序列表"
          active={editor.isActive("bulletList")}
          className="h-[30px] w-[30px] min-h-[30px] min-w-[30px] rounded"
          onMouseDown={preventSelectionLoss}
          onClick={run((value) =>
            value.chain().focus().toggleBulletList().run(),
          )}
        >
          <List size={15} />
        </IconButton>
        <IconButton
          label="有序列表"
          active={editor.isActive("orderedList")}
          className="h-[30px] w-[30px] min-h-[30px] min-w-[30px] rounded"
          onMouseDown={preventSelectionLoss}
          onClick={run((value) =>
            value.chain().focus().toggleOrderedList().run(),
          )}
        >
          <ListOrdered size={15} />
        </IconButton>
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

/** Text-selection actions for desktop context menus and mobile selection toolbars. */
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
  const text = selectedText(editor);
  const hasSelection = Boolean(text.trim());

  useEffect(() => {
    if (!editor) return undefined;
    const update = () => {
      rerender();
      if (editor.state.selection.empty || !selectedText(editor).trim()) {
        setFloatingPosition(null);
        return;
      }
      setFloatingPosition(
        mobile
          ? mobileSelectionMenuPosition(editor)
          : selectionMenuPosition(editor),
      );
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
  }, [hasSelection]);

  const content = (
    <div className="relative">
      {children}
      {editor && !mobile && hasSelection && floatingPosition ? (
        <div
          className="fixed z-[60] w-max max-w-[calc(100vw-24px)] overflow-visible rounded-md border border-[#c9c9c9] bg-white/[0.98] p-[5px] shadow-[0_8px_24px_rgb(15_23_42/0.18)] -translate-x-1/2 -translate-y-[calc(100%+8px)]"
          role="toolbar"
          aria-label="选区浮动工具栏"
          style={{ left: floatingPosition.x, top: floatingPosition.y }}
        >
          <FormatControls editor={editor} />
        </div>
      ) : null}
      {editor && mobile && hasSelection && floatingPosition ? (
        <div
          className="fixed z-[60] w-max max-w-[calc(100vw-16px)] overflow-visible rounded-lg border border-border bg-white/[0.98] p-1.5 shadow-[0_8px_24px_rgb(15_23_42/0.18)] -translate-x-1/2 -translate-y-[calc(100%+8px)] [&_.flex]:overflow-x-auto [&_.flex]:[scrollbar-width:none] [&_.flex::-webkit-scrollbar]:hidden [&_select:first-of-type]:w-[min(132px,36vw)] [&_select:nth-of-type(2)]:w-[74px]"
          role="toolbar"
          aria-label="选区格式菜单"
          style={{ left: floatingPosition.x, top: floatingPosition.y }}
        >
          <FormatControls editor={editor} />
        </div>
      ) : null}
    </div>
  );

  if (!editor) return content;

  // 移动端长按由浏览器负责创建和调整原生文字选区；不要把触摸长按
  // 交给 ContextMenu，否则会抢占选区并阻止用户重新拖动选择范围。
  if (mobile) return content;

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
