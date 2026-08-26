import { useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
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
  const [open, setOpen] = useState(false);
  const [suggestedText, setSuggestedText] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");

  const captureSelection = () => {
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
    setDraft({
      fromText,
      lineNo,
      lineText: lineNo > 0 ? (lines[lineNo - 1] ?? "") : "",
    });
    setSuggestedText(fromText);
    setNotice("");
  };

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
    if (!replacement || replacement === draft.fromText) {
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
      setNotice("修订已提交给作者审核");
      window.getSelection()?.removeAllRanges();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "修订提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div ref={rootRef} onMouseUp={captureSelection} onKeyUp={captureSelection}>
      {draft ? (
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
              required
              rows={3}
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
