import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { RichTextNode } from "../../lib/types";
import { updateLongTextChapter } from "../editor/long-text/long-text-chapter-operations";

interface LongTextEditorBufferOptions {
  contentRef: MutableRefObject<RichTextNode>;
  activeIndexRef: MutableRefObject<number>;
  replaceContent: (next: RichTextNode) => void;
  onChanged: () => void;
}

/** 合并编辑器与章节节点视图的高频写入，再统一提交到整本文档。 */
export function useLongTextEditorBuffer({
  contentRef,
  activeIndexRef,
  replaceContent,
  onChanged,
}: LongTextEditorBufferOptions) {
  // 当前章编辑器和章节节点视图拥有独立缓冲，避免两种更新互相覆盖。
  const pendingEditorRef = useRef<RichTextNode | null>(null);
  const editorTimerRef = useRef<number | null>(null);
  const chapterTimerRef = useRef<number | null>(null);
  const pendingChapterRef = useRef<{
    chapterId: string;
    patch: { title?: string; text?: string };
  } | null>(null);

  // 当前章编辑器只装载一个节点，因此按活动索引写回整本章节数组。
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

  // 节点视图更新按稳定 chapterId 定位，章节移动后也不会写错位置。
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

  // 章节切换和结构操作会主动 flush，确保防抖队列中的最后一次输入不会丢失。
  const flush = useCallback(() => {
    commitEditor();
    commitChapter();
  }, [commitChapter, commitEditor]);

  const updateEditor = useCallback(
    (next: RichTextNode) => {
      const first = next.content?.[0];
      if (!first) return;
      if ((next.content?.length ?? 0) > 1) {
        console.warn("[长文本] 编辑器包含多个节点，仅写回首章");
      }
      // 空转守卫：编辑器对当前章节点的序列化与原节点 JSON 一致（例如外部
      // content 同步、属性顺序重排或清理事务触发的 onChange）时直接忽略，
      // 避免「flush → 编辑器回写 → 再 flush」的无意义自旋改变正文引用。
      const current = contentRef.current.content?.[activeIndexRef.current];
      if (current && JSON.stringify(first) === JSON.stringify(current)) return;
      pendingEditorRef.current = { type: "doc", content: [first] };
      if (editorTimerRef.current !== null)
        window.clearTimeout(editorTimerRef.current);
      editorTimerRef.current = window.setTimeout(commitEditor, 300);
    },
    [activeIndexRef, commitEditor, contentRef],
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
