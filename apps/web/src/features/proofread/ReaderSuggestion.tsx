import { useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button, Dialog } from "../../components/ui";
import { submitSuggestion } from "../../lib/api";

interface SelectionDraft {
  fromText: string;
  lineNo: number;
  lineText: string;
}

/**
 * 读者修订入口：捕获阅读器选区、定位章节内行号并提交待审核建议。
 * 组件应以 documentId + chapterId 作为 key，切章时即可丢弃上一章的瞬时选区。
 */
export function ReaderSuggestion({
  documentId,
  chapterId,
  chapterTitle,
  lines,
  children,
}: {
  documentId: string;
  chapterId: string;
  chapterTitle: string;
  lines: readonly string[];
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<SelectionDraft | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<{
    top: number;
    left: number;
    mobile: boolean;
  } | null>(null);
  const [open, setOpen] = useState(false);
  const [suggestedText, setSuggestedText] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");

  const captureSelection = useCallback(() => {
    const selection = window.getSelection();
    const root = rootRef.current;
    if (!selection || selection.isCollapsed || !root || selection.rangeCount === 0)
      return;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const fromText = selection.toString().trim();
    if (!fromText) return;

    const viewer = root.querySelector<HTMLElement>(
      ".rt-viewer .tiptap.ProseMirror",
    );
    const startElement =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const blocks = viewer ? Array.from(viewer.children) : [];
    const lineIndex = blocks.findIndex(
      (block) =>
        block === startElement ||
        (startElement ? block.contains(startElement) : false),
    );
    const lineNo = lineIndex >= 0 ? lineIndex + 1 : 0;
    const getRect = (
      range as Range & { getBoundingClientRect?: () => DOMRect }
    ).getBoundingClientRect;
    if (typeof getRect === "function") {
      const rect = getRect.call(range);
      if (rect.width > 0 || rect.height > 0) {
        const left = Math.min(
          window.innerWidth - 72,
          Math.max(72, rect.left + rect.width / 2),
        );
        const top = rect.top >= 52 ? rect.top - 44 : rect.bottom + 8;
        const mobile =
          window.innerWidth <= 840 ||
          window.matchMedia?.("(pointer: coarse)").matches === true;
        setSelectionAnchor({ top, left, mobile });
      }
    }
    setDraft({
      fromText,
      lineNo,
      lineText: lineNo > 0 ? (lines[lineNo - 1] ?? "") : "",
    });
    setSuggestedText(fromText);
    setNotice("");
  }, [lines]);

  // 桌面主要触发 mouseup，移动端拖动系统选区手柄时主要触发 selectionchange。
  // 使用动画帧合并连续事件，既跟随最终选区，又不阻止浏览器原生复制/查询菜单。
  useEffect(() => {
    let frame = 0;
    const handleSelectionChange = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(captureSelection);
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [captureSelection]);

  const openDialog = () => {
    if (!draft) return;
    setSuggestedText(draft.fromText);
    setReason("");
    setError("");
    setOpen(true);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    const replacement = suggestedText.trim();
    if (replacement === draft.fromText) {
      setError("请填写与原文不同的修订内容");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await submitSuggestion(documentId, {
        fromText: draft.fromText,
        toText: replacement,
        reason: reason.trim(),
        chapterId,
        chapterTitle,
        lineNo: draft.lineNo,
        lineText: draft.lineText,
      });
      await queryClient.invalidateQueries({
        queryKey: ["forum", "suggestions", documentId],
      });
      setOpen(false);
      setDraft(null);
      setSelectionAnchor(null);
      setNotice("修订已提交给作者审核");
      window.getSelection()?.removeAllRanges();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "修订提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={rootRef}
      onMouseUp={captureSelection}
      onKeyUp={captureSelection}
      onTouchEnd={() => window.requestAnimationFrame(captureSelection)}
    >
      {draft && !selectionAnchor ? (
        <div className="mb-5 flex items-center gap-3 rounded-md border border-[#add4cb] bg-[#edf8f5] px-3 py-2 text-xs text-[#185f57]">
          <span className="min-w-0 flex-1 truncate">
            已选择「{draft.fromText}」
            {draft.lineNo > 0 ? ` · 本章第 ${draft.lineNo} 行` : ""}
          </span>
          <Button size="sm" onClick={openDialog}>
            <Send size={13} />
            提交修订
          </Button>
        </div>
      ) : null}
      {draft && selectionAnchor ? (
        <Button
          size="sm"
          className={
            selectionAnchor.mobile
              ? "fixed right-4 bottom-[calc(16px+env(safe-area-inset-bottom))] left-4 z-[45] h-11 justify-center shadow-xl"
              : "fixed z-[45] h-9 shadow-lg"
          }
          style={
            selectionAnchor.mobile
              ? undefined
              : {
                  top: selectionAnchor.top,
                  left: selectionAnchor.left,
                  transform: "translateX(-50%)",
                }
          }
          onPointerDown={(event) => event.preventDefault()}
          onClick={openDialog}
          aria-label={`提交所选文字修订：${draft.fromText}`}
        >
          <Send size={13} />
          提交修订
        </Button>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="mb-5 rounded-md border border-[#add4cb] bg-[#edf8f5] px-3 py-2 text-xs text-[#185f57]"
        >
          {notice}
        </p>
      ) : null}
      {children}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="提交修订"
        description={`发送给作者审核 · ${chapterTitle}${draft?.lineNo ? ` · 第 ${draft.lineNo} 行` : ""}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              type="submit"
              form="reader-suggestion-form"
              disabled={submitting}
            >
              <Send size={14} />
              {submitting ? "提交中…" : "提交给作者"}
            </Button>
          </>
        }
      >
        <form
          id="reader-suggestion-form"
          className="space-y-4"
          onSubmit={(event) => void submit(event)}
        >
          <label className="block text-xs font-semibold">
            原文
            <textarea
              readOnly
              rows={2}
              value={draft?.fromText ?? ""}
              className="mt-1.5 w-full resize-none rounded-md border border-input bg-muted px-3 py-2 font-normal leading-5 text-muted-foreground"
            />
          </label>
          <label className="block text-xs font-semibold">
            修订为
            <textarea
              autoFocus
              rows={3}
              placeholder="输入替换文字；留空表示删除所选原文"
              value={suggestedText}
              onChange={(event) => setSuggestedText(event.target.value)}
              className="mt-1.5 w-full resize-y rounded-md border border-input bg-white px-3 py-2 font-normal leading-5 outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block text-xs font-semibold">
            修订说明
            <textarea
              rows={3}
              maxLength={500}
              placeholder="说明错字、语句或事实问题（选填）"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1.5 w-full resize-y rounded-md border border-input bg-white px-3 py-2 font-normal leading-5 outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          {error ? (
            <p
              role="alert"
              className="rounded bg-[#fdf1f0] px-2 py-1.5 text-xs text-[#8f2b24]"
            >
              {error}
            </p>
          ) : null}
        </form>
      </Dialog>
    </div>
  );
}
