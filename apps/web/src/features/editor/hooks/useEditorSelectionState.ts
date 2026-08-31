import type { Editor } from "@tiptap/react";
import { useEffect, useReducer } from "react";

/** 当前选区的纯文本（无选区时为空串）。 */
export function getSelectedText(editor: Editor | null): string {
  if (!editor || editor.state.selection.empty) return "";
  return editor.state.doc.textBetween(
    editor.state.selection.from,
    editor.state.selection.to,
    " ",
  );
}

/**
 * 订阅编辑器的 selectionUpdate 与 transaction 事件并触发重渲染，
 * 使调用方在渲染期读取 editor.isActive()/getAttributes() 就能拿到最新
 * 的 mark/node 激活状态。返回递增版本号，仅在确实需要时使用。
 */
export function useEditorSelectionState(editor: Editor | null): number {
  const [version, bump] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    if (!editor) return undefined;
    const update = () => bump();
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);
  return version;
}
