import { useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, Dialog } from "../../components/ui";
import { submitSuggestion } from "../../lib/api";

/** 与编辑器浮动工具栏一致，停止交互后再显示，避免按钮追着手势跳动。 */
const SELECTION_SETTLE_DELAY = 160;

// 原子业务节点、阅读装饰和控件文字不属于可修订的正文。
const NON_PROSE_SELECTOR = [
  '[contenteditable="false"]',
  "button",
  "input",
  "select",
  "textarea",
  '[role="button"]:not(.rt-spoiler)',
  '.rt-spoiler:not([aria-expanded="true"])',
  '[role="radio"]',
  '[role="checkbox"]',
  ".rt-poll",
  ".rt-attachment",
  ".rt-rich-image",
  ".rt-dice-roll",
  ".rt-mention",
  ".rt-inline-comment-anchor-wrap",
  ".rt-reply-gate--locked",
  ".rt-reader-book-title",
  ".rt-reader-topline",
  ".rt-reader-bottomline",
  ".rt-long-text__header",
  '[data-node-type="poll-ref"]',
  '[data-node-type="attachment-ref"]',
  '[data-node-type="rich-image"]',
  '[data-node-type="dice-roll"]',
  '[data-node-type="mention"]',
  '[data-node-type="inline-comment-anchor"]',
].join(",");

function isNonProseNode(viewer: Element, node: Node): boolean {
  let element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  for (; element && element !== viewer; element = element.parentElement) {
    if (element.matches(NON_PROSE_SELECTOR)) return true;
  }
  return false;
}

function isProseRange(viewer: Element, range: Range): boolean {
  if (
    !viewer.contains(range.commonAncestorContainer) ||
    isNonProseNode(viewer, range.startContainer) ||
    isNonProseNode(viewer, range.endContainer)
  )
    return false;
  // 起点和终点在正文中，也可能跨过中间的投票、图片或间贴标记。
  return !Array.from(viewer.querySelectorAll(NON_PROSE_SELECTOR)).some((element) =>
    range.intersectsNode(element),
  );
}

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
  const dialogOpenRef = useRef(false);
  const [selectionSettled, setSelectionSettled] = useState(true);
  const draggingRef = useRef(false);
  const [suggestedText, setSuggestedText] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");

  const clearSelectionDraft = useCallback(() => {
    setDraft(null);
    setSelectionAnchor(null);
  }, []);

  const captureSelection = useCallback(() => {
    // 弹窗取得焦点会改变浏览器选区，此时保留已打开的修订草稿。
    if (dialogOpenRef.current || draggingRef.current) return;
    const selection = window.getSelection();
    const viewer = rootRef.current?.querySelector<HTMLElement>(".rt-viewer .tiptap.ProseMirror");
    if (!selection || selection.isCollapsed || !viewer || selection.rangeCount === 0) {
      clearSelectionDraft();
      return;
    }
    const range = selection.getRangeAt(0);
    const fromText = selection.toString().trim();
    if (!isProseRange(viewer, range) || !fromText) {
      clearSelectionDraft();
      return;
    }
    setSelectionAnchor(null);
    const startElement =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const blocks = viewer ? Array.from(viewer.children) : [];
    const lineIndex = blocks.findIndex(
      (block) => block === startElement || (startElement ? block.contains(startElement) : false),
    );
    const lineNo = lineIndex >= 0 ? lineIndex + 1 : 0;
    const getRect = (range as Range & { getBoundingClientRect?: () => DOMRect })
      .getBoundingClientRect;
    if (typeof getRect === "function") {
      const rect = getRect.call(range);
      if (rect.width > 0 || rect.height > 0) {
        const viewport = window.visualViewport;
        const viewportTop = viewport?.offsetTop ?? 0;
        const viewportLeft = viewport?.offsetLeft ?? 0;
        const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
        const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
        if (
          rect.bottom <= viewportTop ||
          rect.top >= viewportBottom ||
          rect.right <= viewportLeft ||
          rect.left >= viewportRight
        ) {
          clearSelectionDraft();
          return;
        }
        // 内层阅读容器也可能独立滚动，被裁出的选区不应留下浮动入口。
        for (
          let parent = startElement;
          parent && parent !== document.body;
          parent = parent.parentElement
        ) {
          const style = getComputedStyle(parent);
          const clipsY = /auto|scroll|hidden|clip/.test(style.overflowY);
          const clipsX = /auto|scroll|hidden|clip/.test(style.overflowX);
          if (!clipsY && !clipsX) continue;
          const bounds = parent.getBoundingClientRect();
          if (
            (clipsY && (rect.bottom <= bounds.top || rect.top >= bounds.bottom)) ||
            (clipsX && (rect.right <= bounds.left || rect.left >= bounds.right))
          ) {
            clearSelectionDraft();
            return;
          }
        }
        const left = Math.min(
          viewportRight - 72,
          Math.max(viewportLeft + 72, rect.left + rect.width / 2),
        );
        const top = Math.min(
          viewportBottom - 44,
          Math.max(viewportTop + 8, rect.top >= viewportTop + 52 ? rect.top - 44 : rect.bottom + 8),
        );
        const mobile =
          window.innerWidth <= 840 || window.matchMedia?.("(pointer: coarse)").matches === true;
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
  }, [clearSelectionDraft, lines]);

  useEffect(() => {
    let timer = 0;
    const hold = () => {
      window.clearTimeout(timer);
      setSelectionSettled(false);
    };
    const release = () => {
      window.clearTimeout(timer);
      if (draggingRef.current) return;
      timer = window.setTimeout(() => {
        captureSelection();
        setSelectionSettled(true);
      }, SELECTION_SETTLE_DELAY);
    };
    const onSelectionChange = () => {
      if (dialogOpenRef.current) return;
      hold();
      release();
    };
    const onPointerDown = (event: PointerEvent) => {
      const viewer = rootRef.current?.querySelector(".rt-viewer .tiptap.ProseMirror");
      if (
        dialogOpenRef.current ||
        !(event.target instanceof Node) ||
        !viewer?.contains(event.target)
      )
        return;
      if (isNonProseNode(viewer, event.target)) {
        clearSelectionDraft();
        // 单选框等控件可能保留旧正文选区，显式取消以免松手或滚动后入口再次出现。
        const selection = window.getSelection();
        if (
          selection?.rangeCount &&
          viewer.contains(selection.getRangeAt(0).commonAncestorContainer)
        )
          selection.removeAllRanges();
        return;
      }
      draggingRef.current = true;
      hold();
    };
    const onPointerUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      release();
    };
    // 捕获滚动容器事件；视觉视口变化覆盖手机键盘和缩放，不阻止原生滚动。
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    window.addEventListener("scroll", onSelectionChange, { capture: true, passive: true });
    window.addEventListener("resize", onSelectionChange);
    const viewport = window.visualViewport;
    viewport?.addEventListener("scroll", onSelectionChange, { passive: true });
    viewport?.addEventListener("resize", onSelectionChange);
    return () => {
      window.clearTimeout(timer);
      draggingRef.current = false;
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("scroll", onSelectionChange, true);
      window.removeEventListener("resize", onSelectionChange);
      viewport?.removeEventListener("scroll", onSelectionChange);
      viewport?.removeEventListener("resize", onSelectionChange);
    };
  }, [captureSelection, clearSelectionDraft]);

  const setDialogOpen = (next: boolean) => {
    dialogOpenRef.current = next;
    setOpen(next);
    if (!next) {
      clearSelectionDraft();
      window.getSelection()?.removeAllRanges();
    }
  };

  const openDialog = () => {
    if (!draft) return;
    // 选区事件可能仍在等待动画帧，点击时再核对，不能提交已取消的旧选区。
    const selection = window.getSelection();
    const viewer = rootRef.current?.querySelector(".rt-viewer .tiptap.ProseMirror");
    if (
      !selection ||
      selection.isCollapsed ||
      !selection.rangeCount ||
      !viewer ||
      !isProseRange(viewer, selection.getRangeAt(0)) ||
      selection.toString().trim() !== draft.fromText
    ) {
      clearSelectionDraft();
      return;
    }
    setSuggestedText(draft.fromText);
    setReason("");
    setError("");
    setDialogOpen(true);
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
      setDialogOpen(false);
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
      {!open && selectionSettled && draft && !selectionAnchor ? (
        <div className="mb-5 flex items-center gap-3 rounded-md border border-[#add4cb] bg-[#edf8f5] px-3 py-2 text-xs text-[#185f57]">
          <span className="min-w-0 flex-1 truncate">
            已选择「{draft.fromText}」{draft.lineNo > 0 ? ` · 本章第 ${draft.lineNo} 行` : ""}
          </span>
          <Button size="sm" onPointerDown={(event) => event.preventDefault()} onClick={openDialog}>
            <Send size={13} />
            提交修订
          </Button>
        </div>
      ) : null}
      {!open && selectionSettled && draft && selectionAnchor ? (
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
        onOpenChange={setDialogOpen}
        title="提交修订"
        description={`发送给作者审核 · ${chapterTitle}${draft?.lineNo ? ` · 第 ${draft.lineNo} 行` : ""}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button type="submit" form="reader-suggestion-form" disabled={submitting}>
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
            <p role="alert" className="rounded bg-[#fdf1f0] px-2 py-1.5 text-xs text-[#8f2b24]">
              {error}
            </p>
          ) : null}
        </form>
      </Dialog>
    </div>
  );
}
