import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { EditorContextMenu } from "./EditorContextMenu";
import { SelectionFloatingToolbar } from "./SelectionFloatingToolbar";
import { getSelectedText, useEditorSelectionState } from "../hooks/useEditorSelectionState";

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
  // selectionUpdate/transaction 驱动重渲染，选区浮动工具栏与右键菜单
  // 借此在渲染期读取最新选区状态与编辑器激活状态。
  useEditorSelectionState(editor);
  const hasSelection = Boolean(getSelectedText(editor).trim());

  const content = (
    <div className="relative">
      {children}
      <SelectionFloatingToolbar
        editor={editor}
        mobile={mobile}
        visible={hasSelection}
      />
    </div>
  );

  if (!editor) return content;

  // 移动端长按由浏览器负责创建和调整原生文字选区；不要把触摸长按
  // 交给 ContextMenu，否则会抢占选区并阻止用户重新拖动选择范围。
  if (mobile) return content;

  return (
    <EditorContextMenu editor={editor} hasSelection={hasSelection}>
      {content}
    </EditorContextMenu>
  );
}
