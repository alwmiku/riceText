import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { useEditorSelectionState } from "../hooks/useEditorSelectionState";
import { CompactToolbarControls } from "./CompactToolbarControls";
import { ToolbarDialogs, useInsertRequest } from "./ToolbarDialogs";
import { FormatPainterButton, IndentPopover } from "./FormattingTools";
import {
  BusinessNodeGroup,
  ParagraphGroup,
  TextFormatGroup,
  UndoRedoGroup,
} from "./DesktopToolbarGroups";

/** 完整/移动 Sheet 共用的格式与业务节点工具栏。 */
export function Toolbar({
  editor,
  condensed = false,
  disabled = false,
}: {
  editor: Editor | null;
  condensed?: boolean;
  /** 只读态整体禁用：保留工具栏外观以标明这是编辑界面，但不接受任何操作。 */
  disabled?: boolean;
}) {
  const requestInsert = useInsertRequest();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [compactLayout, setCompactLayout] = useState(condensed);
  const [wholeDocument, setWholeDocument] = useState(false);
  useEffect(() => {
    setWholeDocument(false);
  }, [editor]);
  useEditorSelectionState(editor);
  useEffect(() => {
    if (condensed) {
      setCompactLayout(true);
      return undefined;
    }
    const element = toolbarRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const update = () => {
      const width = element.getBoundingClientRect().width;
      setCompactLayout(width > 0 && width < 760);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [condensed, editor]);
  if (!editor)
    return (
      <div
        className="sticky top-[58px] z-20 flex min-h-[46px] flex-wrap items-center gap-[3px] border-b border-border bg-[#fbfcfc] px-[7px] py-[5px] max-[430px]:top-[54px]"
        aria-hidden="true"
      />
    );

  const groups = compactLayout ? (
    <>
      {!condensed && <FormatPainterButton editor={editor} />}
      <CompactToolbarControls
        editor={editor}
        mobile={condensed}
        wholeDocument={wholeDocument}
        onWholeDocumentChange={setWholeDocument}
      />
    </>
  ) : (
    <>
      <UndoRedoGroup editor={editor} />
      <FormatPainterButton editor={editor} />
      <TextFormatGroup editor={editor} condensed={condensed} />
      <ParagraphGroup editor={editor} condensed={condensed} />
      <IndentPopover
        editor={editor}
        wholeDocument={wholeDocument}
        onWholeDocumentChange={setWholeDocument}
      />
      <BusinessNodeGroup editor={editor} condensed={condensed} />
    </>
  );

  const content = (
    <div
      ref={toolbarRef}
      className={
        condensed
          ? "flex min-w-0 items-center gap-1"
          : "sticky top-[58px] z-20 flex min-h-[46px] flex-wrap items-center gap-[3px] border-b border-border bg-[#fbfcfc] px-[7px] py-[5px] max-[430px]:top-[54px]"
      }
      role="toolbar"
      aria-label="富文本工具栏"
      aria-disabled={disabled || undefined}
    >
      {/* 只读态用 fieldset 原生禁用整组控件：指针与键盘都无法触发，外观保持编辑界面。 */}
      {disabled ? (
        <fieldset disabled className="contents">
          {groups}
        </fieldset>
      ) : (
        groups
      )}
      {disabled && !condensed ? (
        <span className="ml-auto shrink-0 rounded bg-[#eef1f2] px-2 py-0.5 text-[11px] font-semibold text-[#68737d]">
          只读 · 仅预览
        </span>
      ) : null}
    </div>
  );

  // 独立使用（如 CompactInsertMenu）时自带对话框 Provider；
  // 被 RichTextEditor 等宿主用 ToolbarDialogs 包裹时共享同一请求通道。
  if (requestInsert === undefined) {
    return <ToolbarDialogs editor={editor}>{content}</ToolbarDialogs>;
  }
  return content;
}
