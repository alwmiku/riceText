import Placeholder from "@tiptap/extension-placeholder";
import { editorExtensions, NodeSelection } from "@ricetext/editor-core";
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
import {
  describeSteps,
  cmd,
  isRichNodeActive,
  type StepJson,
} from "./commands";
import { SelectionFormatMenu } from "./SelectionFormatMenu";
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
  /** 光标处切章：宿主负责把章节拆为两章并重建编辑器。 */
  onSplitChapter?: (before: string, after: string) => void;
  /** 章节编辑（标题/正文）：宿主把修改写回整体数据，节点属性保持不变。 */
  onChapterEdit?: (
    chapterId: string,
    patch: { title?: string; text?: string },
  ) => void;
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
  onSplitChapter,
  onChapterEdit,
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

  // 把宿主的“光标处切章”和“章节编辑”处理器注册到 longTextBlock 扩展存储，
  // 节点视图只通过回调与宿主通信，不直接修改节点属性。
  useEffect(() => {
    if (!editor) return undefined;
    const storage = (
      editor.storage as unknown as {
        longTextBlock?: {
          onSplit?: null | ((before: string, after: string) => void);
          onChapterEdit?:
            | null
            | ((
                chapterId: string,
                patch: { title?: string; text?: string },
              ) => void);
        };
      }
    ).longTextBlock;
    if (!storage) return undefined;
    storage.onSplit = onSplitChapter ?? null;
    storage.onChapterEdit = onChapterEdit ?? null;
    return () => {
      storage.onSplit = null;
      storage.onChapterEdit = null;
    };
  }, [editor, onSplitChapter, onChapterEdit]);

  // 长文本模式：编辑器文档被污染为多个节点时，用事务直接删除多余节点，
  // 只保留第一个章节节点，并把选区固定到该节点（避免编辑器切回预览态）。
  useEffect(() => {
    if (!editor || !longTextMode) return undefined;
    const handler = () => {
      if (editor.state.doc.childCount <= 1) return;
      const nodes = [] as Array<{
        type: string;
        title: string;
        chapterId: string;
        chars: number;
      }>;
      editor.state.doc.forEach((node) => {
        nodes.push({
          type: node.type.name,
          title: String(node.attrs.title ?? ""),
          chapterId: String(node.attrs.chapterId ?? ""),
          chars: String(node.attrs.text ?? "").length,
        });
      });
      console.warn("[长文本] 自动清理多节点编辑器文档", nodes);
      let keepFrom = -1;
      let keepTo = -1;
      editor.state.doc.forEach((node, offset) => {
        if (keepFrom < 0 && node.type.name === "longTextBlock") {
          keepFrom = offset;
          keepTo = offset + node.nodeSize;
        }
      });
      if (keepFrom < 0) return;
      const { tr } = editor.state;
      if (keepTo < editor.state.doc.content.size) {
        tr.delete(keepTo, editor.state.doc.content.size);
      }
      if (keepFrom > 0) {
        tr.delete(0, keepFrom);
      }
      tr.setSelection(NodeSelection.create(tr.doc, 0));
      editor.view.dispatch(tr);
      console.warn(
        "[长文本] 清理后立即 childCount=",
        editor.state.doc.childCount,
      );
      window.setTimeout(() => {
        console.warn(
          "[长文本] 清理后 300ms childCount=",
          editor.state.doc.childCount,
        );
      }, 300);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor, longTextMode]);

  // 权限或首屏加载状态变化时，只切换编辑能力，不重建 ProseMirror 实例。
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);
  // 回滚/远端装载属于受控更新；emitUpdate=false 防止被误判为新的用户编辑代次。
  // 长文本模式通过 key 重建实例装载整本文档，不需要对超大 JSON 做全量比较。
  // setContent 命令会被 inlineCommentAnchor 的保护过滤器拦截（整篇替换会删除锚点），
  // 这里显式构造替换事务并标记为宿主导入以放行，preventUpdate 保持静默同步。
  useEffect(() => {
    if (longTextMode) return;
    if (!editor || JSON.stringify(editor.getJSON()) === JSON.stringify(content))
      return;
    const tr = editor.state.tr;
    tr.setMeta("preventUpdate", true);
    tr.setMeta("hostContentReplace", true);
    const nodes = editor.schema.nodeFromJSON(content);
    tr.replaceWith(0, editor.state.doc.content.size, nodes.content);
    editor.view.dispatch(tr);
  }, [content, editor, longTextMode]);
  // 显式销毁 EditorView，避免路由切换后残留 DOM 监听器。
  useEffect(() => () => editor?.destroy(), [editor]);

  const wordCount = useMemo(
    () =>
      editor && !longTextMode ? editor.getText().replace(/\s+/g, "").length : 0,
    [editor, lastTransactionAt, longTextMode],
  );

  if (longTextMode)
    return (
      <div className="overflow-clip rounded-lg border border-border bg-white shadow-panel max-[430px]:rounded-none max-[430px]:border-x-0">
        <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-border py-2 pr-2.5 pl-3.5 max-[430px]:min-h-12 max-[430px]:pr-3 max-[430px]:pl-3">
          <div className="min-w-0">
            <p className="min-w-0 truncate text-[15px] font-bold">长文本编辑</p>
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
        <div className="min-h-[560px] bg-white">
          <SelectionFormatMenu editor={editor}>
            <EditorContent
              editor={editor}
              className="tiptap min-h-[560px] px-[clamp(28px,7vw,92px)] py-[52px] pb-[100px] font-serif text-[17px] leading-[1.9] text-[#232a31] outline-none"
            />
          </SelectionFormatMenu>
        </div>
      </div>
    );

  if (mode === "compact")
    return (
      <div className="mx-auto mt-14 max-w-[860px] rounded-lg border border-border bg-white shadow-panel max-[840px]:mt-[18px] max-[430px]:rounded-none max-[430px]:border-x-0">
        <div className="min-h-[150px] bg-white">
          <SelectionFormatMenu editor={editor}>
            <EditorContent
              editor={editor}
              className="tiptap min-h-[150px] px-5 py-[18px] font-sans text-[15px] leading-[1.7] outline-none"
            />
          </SelectionFormatMenu>
        </div>
        <div className="flex items-center justify-between border-t border-border p-2">
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
        <div className="mx-auto max-w-[680px] rounded-lg border border-border bg-white pb-[calc(74px+env(safe-area-inset-bottom))] shadow-panel max-[430px]:rounded-none max-[430px]:border-x-0">
          <div className="min-h-[560px] bg-white">
            <SelectionFormatMenu editor={editor} mobile>
              <EditorContent
                editor={editor}
                className="tiptap min-h-[calc(100vh-190px)] px-[18px] py-6 pb-[90px] font-serif text-base leading-[1.9] outline-none"
              />
            </SelectionFormatMenu>
          </div>
          <div className="fixed inset-x-0 bottom-0 z-[35] flex min-h-[58px] items-center justify-around gap-1 border-t border-border bg-white/[0.97] px-2 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom))] backdrop-blur-xl [&_button]:min-h-11 [&_button]:min-w-11">
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
    <div className="overflow-clip rounded-lg border border-border bg-white shadow-panel max-[430px]:rounded-none max-[430px]:border-x-0">
      <Toolbar editor={editor} />
      <div className="min-h-[560px] bg-white">
        <SelectionFormatMenu editor={editor}>
          <EditorContent
            editor={editor}
            className="tiptap min-h-[560px] px-[clamp(28px,7vw,92px)] py-[52px] pb-[100px] font-serif text-[17px] leading-[1.9] text-[#232a31] outline-none"
          />
        </SelectionFormatMenu>
      </div>
      <footer className="flex min-h-[34px] flex-wrap items-center justify-end gap-x-5 gap-y-1 border-t border-[#e3e7ea] bg-[#fafbfc] px-3.5 py-1.5 text-xs text-[#68737d]">
        <span>
          字数{" "}
          <strong className="font-semibold text-[#37414b] tabular-nums">
            {wordCount.toLocaleString()}
          </strong>
        </span>
        <span>
          最近保存{" "}
          <strong className="font-semibold text-[#37414b] tabular-nums">
            {savedAt ? formatTime(savedAt) : "—"}
          </strong>
        </span>
        <span>
          最近更新{" "}
          <strong className="font-semibold text-[#37414b] tabular-nums">
            {lastTransactionAt !== null
              ? new Date(lastTransactionAt).toLocaleTimeString("zh-CN", {
                  hour12: false,
                })
              : "—"}
          </strong>
          {lastAction ? (
            <em className="font-semibold not-italic text-[#14766d]">
              · {lastAction}
            </em>
          ) : null}
        </span>
      </footer>
    </div>
  );
}

export function CompactInsertMenu({ editor }: { editor: Editor | null }) {
  return editor ? <Toolbar editor={editor} condensed /> : null;
}
