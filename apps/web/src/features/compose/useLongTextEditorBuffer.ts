import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { RichTextNode } from "../../lib/types";
import { updateLongTextChapter } from "../editor/long-text-chapter-operations";

interface LongTextEditorBufferOptions {
  contentRef: MutableRefObject<RichTextNode>;
  activeIndexRef: MutableRefObject<number>;
  replaceContent: (next: RichTextNode) => void;
  onChanged: () => void;
}

/** Coalesces editor and node-view writes before committing them to the full book. */
export function useLongTextEditorBuffer({
  contentRef,
  activeIndexRef,
  replaceContent,
  onChanged,
}: LongTextEditorBufferOptions) {
  const pendingEditorRef = useRef<RichTextNode | null>(null);
  const editorTimerRef = useRef<number | null>(null);
  const chapterTimerRef = useRef<number | null>(null);
  const pendingChapterRef = useRef<{
    chapterId: string;
    patch: { title?: string; text?: string };
  } | null>(null);

  const commitEditor = useCallback(() => {
    if (editorTimerRef.current !== null) {
      window.clearTimeout(editorTimerRef.current);
      editorTimerRef.current = null;
    }
    const pending = pendingEditorRef.current;
    pendingEditorRef.current = null;
    const first = pending?.content?.[0];
    if (!first) return;
    const nodes = [...(contentRef.current.content ?? [])];
    nodes.splice(activeIndexRef.current, 1, first);
    replaceContent({ type: "doc", content: nodes });
    onChanged();
  }, [activeIndexRef, contentRef, onChanged, replaceContent]);

  const commitChapter = useCallback(() => {
    if (chapterTimerRef.current !== null) {
      window.clearTimeout(chapterTimerRef.current);
      chapterTimerRef.current = null;
    }
    const pending = pendingChapterRef.current;
    pendingChapterRef.current = null;
    if (!pending) return;
    const updated = updateLongTextChapter(
      contentRef.current,
      pending.chapterId,
      pending.patch,
    );
    if (!updated) return;
    replaceContent(updated);
    onChanged();
  }, [contentRef, onChanged, replaceContent]);

  const flush = useCallback(() => {
    commitEditor();
    commitChapter();
  }, [commitChapter, commitEditor]);

  const updateEditor = useCallback(
    (next: RichTextNode) => {
      const first = next.content?.[0];
      if (!first) return;
      if ((next.content?.length ?? 0) > 1) {
        console.warn("[长文本] 编辑器包含多个章节，仅写回首章");
      }
      pendingEditorRef.current = { type: "doc", content: [first] };
      if (editorTimerRef.current !== null)
        window.clearTimeout(editorTimerRef.current);
      editorTimerRef.current = window.setTimeout(commitEditor, 300);
    },
    [commitEditor],
  );

  const editChapter = useCallback(
    (chapterId: string, patch: { title?: string; text?: string }) => {
      pendingChapterRef.current = { chapterId, patch };
      if (chapterTimerRef.current !== null)
        window.clearTimeout(chapterTimerRef.current);
      chapterTimerRef.current = window.setTimeout(commitChapter, 300);
    },
    [commitChapter],
  );

  useEffect(() => {
    return () => {
      if (editorTimerRef.current !== null)
        window.clearTimeout(editorTimerRef.current);
      if (chapterTimerRef.current !== null)
        window.clearTimeout(chapterTimerRef.current);
    };
  }, []);

  return { flush, updateEditor, editChapter };
}
