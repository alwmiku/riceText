import Placeholder from "@tiptap/extension-placeholder";
import { editorExtensions } from "@ricetext/editor-core";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import {
  Bold,
  ChevronDown,
  Dice5,
  ImagePlus,
  MoreHorizontal,
  Send,
  TextQuote,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from "../../components/ui";
import type { EditorMode, RichTextNode } from "../../lib/types";
import { formatTime } from "../../lib/utils";
import { ChapterSidebar } from "../novel/ChapterSidebar";
import {
  describeSteps,
  cmd,
  isRichNodeActive,
  type StepJson,
} from "./commands";
import { Toolbar } from "./Toolbar";

/** RichTextEditor 的稳定公共属性；宿主只需持有 JSON，不接触 ProseMirror 实例。 */
export interface RichTextEditorProps {
  content: RichTextNode;
  mode: EditorMode;
  editable?: boolean;
  longTextMode?: boolean;
  onChange: (content: RichTextNode) => void;
  /** 每次事务产生 ProseMirror steps 时回调，供增量同步使用。 */
  onChangeSteps?: (steps: unknown[]) => void;
  onSubmit?: (content: RichTextNode) => void;
  onReady?: (editor: Editor | null) => void;
  /** 最近一次成功保存时间，显示在编辑器底部。 */
  savedAt?: string;
  onExpand?: () => void;
  onCommentAnchorOpen?: (threadId: string) => void;
  onModeToolsOpen?: () => void;
}

/** Web 宿主编辑器：复用 editor-core schema，并按 compact/full/mobile 组合不同工具表面。 */
export function RichTextEditor({
  content,
  mode,
  editable = true,
  longTextMode = false,
  onChange,
  onChangeSteps,
  onSubmit,
  onReady,
  savedAt,
  onExpand,
  onCommentAnchorOpen,
  onModeToolsOpen,
}: RichTextEditorProps) {
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [lastTransactionAt, setLastTransactionAt] = useState<number | null>(
    null,
  );
  const [lastAction, setLastAction] = useState("");
  const extensions = useMemo(
    () =>
      editorExtensions({
        resizableImages: true,
        additionalExtensions: [
          Placeholder.configure({
            placeholder: mode === "compact" ? "写下回复…" : "开始写作…",
          }),
        ],
      }),
    [mode],
  );
  const editor = useEditor({
    extensions,
    content,
    editable,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor: value, transaction }) => {
      onChange(value.getJSON() as RichTextNode);
      onChangeSteps?.(transaction.steps.map((step) => step.toJSON()));
    },
    editorProps: {
      attributes: {
        "aria-label": mode === "compact" ? "快速回复编辑区" : "正文编辑区",
      },
      handleClickOn(_view, _pos, node) {
        if (node.type.name === "inlineCommentAnchor") {
          onCommentAnchorOpen?.(String(node.attrs.threadId));
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    if (!editor) return undefined;
    const onTransaction = (payload: unknown) => {
      const transaction = (payload as { transaction?: unknown }).transaction;
      const steps =
        (
          transaction as {
            steps?: readonly { toJSON(): StepJson }[];
          }
        )?.steps ?? [];
      setLastTransactionAt(Date.now());
      setLastAction(describeSteps(steps));
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor]);

  useEffect(() => {
    onReady?.(editor ?? null);
    return () => onReady?.(null);
  }, [editor, onReady]);

  // 权限或首屏加载状态变化时，只切换编辑能力，不重建 ProseMirror 实例。
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);
  // 回滚/远端装载属于受控更新；emitUpdate=false 防止被误判为新的用户编辑代次。
  useEffect(() => {
    if (!editor || JSON.stringify(editor.getJSON()) === JSON.stringify(content))
      return;
    editor.commands.setContent(content, { emitUpdate: false });
  }, [content, editor]);
  // 显式销毁 EditorView，避免路由切换后残留 DOM 监听器。
  useEffect(() => () => editor?.destroy(), [editor]);

  const wordCount = useMemo(
    () => (editor ? editor.getText().replace(/\s+/g, "").length : 0),
    [editor, lastTransactionAt],
  );

  if (longTextMode)
    return (
      <div className="surface mobile-edge overflow-clip">
        <div className="document-bar">
          <div className="min-w-0">
            <p className="document-title">长文本编辑</p>
          </div>
          {onSubmit ? (
            <Button
              size="sm"
              onClick={() =>
                editor && onSubmit(editor.getJSON() as RichTextNode)
              }
            >
              <Send size={14} />
              保存
            </Button>
          ) : null}
        </div>
        <div className="long-text-workspace">
          <ChapterSidebar editor={editor} />
          <div className="editor-content-wrap">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    );

  if (mode === "compact")
    return (
      <div className="compact-shell surface mobile-edge">
        <div className="editor-content-wrap">
          <EditorContent editor={editor} />
        </div>
        <div className="compact-actions">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontal size={16} />
                更多
                <ChevronDown size={13} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => onExpand?.()}>
                <TextQuote size={15} />
                切换完整编辑器
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onModeToolsOpen?.()}>
                <ImagePlus size={15} />
                插入图片或骰子
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            onClick={() =>
              editor && onSubmit?.(editor.getJSON() as RichTextNode)
            }
          >
            <Send size={15} />
            发布回复
          </Button>
        </div>
      </div>
    );

  if (mode === "mobile")
    return (
      <>
        <div className="mobile-editor surface mobile-edge">
          <div className="editor-content-wrap">
            <EditorContent editor={editor} />
          </div>
          <div className="mobile-toolbar">
            <IconButton
              label="加粗"
              active={Boolean(editor?.isActive("bold"))}
              disabled={Boolean(editor?.isActive("spoiler"))}
              onClick={cmd(editor, (value) =>
                value.chain().focus().toggleBold().run(),
              )}
            >
              <Bold size={18} />
            </IconButton>
            <IconButton
              label="插入图片"
              active={editor ? isRichNodeActive(editor, "richImage") : false}
              onClick={() => setMobileToolsOpen(true)}
            >
              <ImagePlus size={18} />
            </IconButton>
            <IconButton
              label="插入骰子"
              active={editor ? isRichNodeActive(editor, "diceRoll") : false}
              onClick={() => setMobileToolsOpen(true)}
            >
              <Dice5 size={18} />
            </IconButton>
            <IconButton
              label="更多工具"
              onClick={() => setMobileToolsOpen(true)}
            >
              <MoreHorizontal size={19} />
            </IconButton>
            <Button
              size="icon"
              aria-label="发布"
              onClick={() =>
                editor && onSubmit?.(editor.getJSON() as RichTextNode)
              }
            >
              <Send size={18} />
            </Button>
          </div>
        </div>
        <Dialog
          open={mobileToolsOpen}
          onOpenChange={setMobileToolsOpen}
          title="编辑工具"
          description="选择排版或插入内容。"
          className="!bottom-0 !top-auto !w-full !max-w-none !translate-y-0 rounded-b-none"
        >
          <Toolbar editor={editor} />
        </Dialog>
      </>
    );

  return (
    <div className="surface mobile-edge overflow-clip">
      <Toolbar editor={editor} />
      <div className="editor-content-wrap">
        <EditorContent editor={editor} />
      </div>
      <footer className="editor-footer">
        <span>
          字数 <strong>{wordCount.toLocaleString()}</strong>
        </span>
        <span>
          最近保存 <strong>{savedAt ? formatTime(savedAt) : "—"}</strong>
        </span>
        <span>
          最近更新{" "}
          <strong>
            {lastTransactionAt !== null
              ? new Date(lastTransactionAt).toLocaleTimeString("zh-CN", {
                  hour12: false,
                })
              : "—"}
          </strong>
          {lastAction ? <em>· {lastAction}</em> : null}
        </span>
      </footer>
    </div>
  );
}

export function CompactInsertMenu({ editor }: { editor: Editor | null }) {
  return editor ? <Toolbar editor={editor} condensed /> : null;
}
