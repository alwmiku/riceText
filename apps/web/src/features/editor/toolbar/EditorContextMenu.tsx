import type { Editor } from "@tiptap/react";
import {
  Bold,
  Eraser,
  Italic,
  Redo2,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
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
import {
  clearFormatting,
  redo,
  selectAll,
  setColor,
  setFontFamily,
  setFontSize,
  toggleBold,
  toggleItalic,
  toggleUnderline,
  undo,
} from "../editor-actions";
import {
  FONT_FAMILIES,
  FONT_SIZES,
  INSERT_CONTENT_TOOLS,
  TOOLBAR_COLORS,
  type InsertTool,
} from "../editor-tool-definitions";
import { useInsertRequest } from "./ToolbarDialogs";

/** 右键菜单的插入请求延迟一拍派发：等菜单完全关闭后再打开对话框。 */
function deferredInsertRequest(
  requestInsert: ((tool: InsertTool) => void) | undefined,
  tool: InsertTool,
) {
  if (!requestInsert) return;
  window.setTimeout(() => requestInsert(tool), 0);
}

function InsertContentSubmenu({
  requestInsert,
}: {
  requestInsert: ((tool: InsertTool) => void) | undefined;
}) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>插入内容</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {INSERT_CONTENT_TOOLS.map((item) => {
          const Icon = item.icon;
          return (
            <ContextMenuItem
              key={item.tool}
              onSelect={() => deferredInsertRequest(requestInsert, item.tool)}
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
          onSelect={() => toggleBold(editor)}
        >
          <Bold />
          加粗
        </ContextMenuItem>
        <ContextMenuItem
          disabled={spoilerActive}
          onSelect={() => toggleItalic(editor)}
        >
          <Italic />
          斜体
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => toggleUnderline(editor)}>
          <UnderlineIcon />
          下划线
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => clearFormatting(editor)}>
          <Eraser />
          清除样式
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>字体</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {FONT_FAMILIES.map((font) => (
              <ContextMenuItem
                key={font.value}
                disabled={spoilerActive}
                onSelect={() => setFontFamily(editor, font.value)}
              >
                {font.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>字号</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {FONT_SIZES.map((fontSize) => (
              <ContextMenuItem
                key={fontSize}
                disabled={spoilerActive}
                onSelect={() => setFontSize(editor, fontSize)}
              >
                {fontSize}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>文字颜色</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {TOOLBAR_COLORS.map((color) => (
              <ContextMenuItem
                key={color}
                disabled={spoilerActive}
                onSelect={() => setColor(editor, color)}
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
  const requestInsert = useInsertRequest();
  return (
    <>
      <ContextMenuItem
        disabled={!editor.can().undo()}
        onSelect={() => undo(editor)}
      >
        <Undo2 />
        撤销<ContextMenuShortcut>Ctrl+Z</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!editor.can().redo()}
        onSelect={() => redo(editor)}
      >
        <Redo2 />
        重做<ContextMenuShortcut>Ctrl+Y</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => selectAll(editor)}>
        全选<ContextMenuShortcut>Ctrl+A</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      {hasSelection ? <TextFormatSubmenu editor={editor} /> : null}
      <InsertContentSubmenu requestInsert={requestInsert} />
    </>
  );
}

/** 桌面编辑区右键菜单：撤销/重做/全选、选区文字格式与插入内容子菜单。 */
export function EditorContextMenu({
  editor,
  hasSelection,
  children,
}: {
  editor: Editor;
  hasSelection: boolean;
  children: ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        aria-label={hasSelection ? "选区格式菜单" : "编辑上下文菜单"}
      >
        <EditorContextItems editor={editor} hasSelection={hasSelection} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
