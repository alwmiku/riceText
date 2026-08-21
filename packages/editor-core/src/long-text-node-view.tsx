import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

/**
 * 长文本块 NodeView。
 *
 * 当前先使用 textarea 作为可用原型，后续可替换为虚拟滚动/按需渲染组件。
 * 输入会防抖同步回 ProseMirror 的 longTextBlock 属性。
 */
export function LongTextView({
  node,
  updateAttributes,
  editor,
  getPos,
}: NodeViewProps) {
  const attrs = node.attrs as unknown as {
    chapterId: string;
    title: string;
    text: string;
    order: number;
  };
  const [value, setValue] = useState(attrs.text ?? "");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const lineHeight = 24;
  const viewportHeight = 480;
  const lines = useMemo(() => value.split("\n"), [value]);
  const totalHeight = Math.max(1, lines.length) * lineHeight;

  useEffect(() => {
    setValue(attrs.text ?? "");
  }, [attrs.text]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleChange = useCallback(
    (next: string) => {
      setValue(next);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        updateAttributes({ text: next });
      }, 300);
    },
    [updateAttributes],
  );

  const syncScrollFromContainer = useCallback(() => {
    const container = containerRef.current;
    const textarea = textareaRef.current;
    if (!container || !textarea) return;
    textarea.scrollTop = container.scrollTop;
    setScrollTop(container.scrollTop);
  }, []);

  const syncScrollFromTextarea = useCallback(() => {
    const container = containerRef.current;
    const textarea = textareaRef.current;
    if (!container || !textarea) return;
    container.scrollTop = textarea.scrollTop;
    setScrollTop(textarea.scrollTop);
  }, []);

  const startLine = Math.max(0, Math.floor(scrollTop / lineHeight) - 5);
  const endLine = Math.min(
    lines.length,
    Math.ceil((scrollTop + viewportHeight) / lineHeight) + 5,
  );
  const visibleLines = lines.slice(startLine, endLine);

  const splitHere = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || !getPos) return;
    const cursor = textarea.selectionStart ?? textarea.value.length;
    const before = textarea.value.slice(0, cursor);
    const after = textarea.value.slice(cursor);
    if (!after.trim()) return;

    updateAttributes({ text: before });

    const insertAt = getPos() + node.nodeSize;
    editor
      .chain()
      .focus()
      .insertContentAt(insertAt, {
        type: "longTextBlock",
        attrs: {
          chapterId: `chapter-${Date.now()}`,
          title: `第 ${node.attrs.order + 1} 章`,
          text: after,
          order: (node.attrs.order ?? 0) + 1,
        },
      })
      .run();
  }, [editor, getPos, node.nodeSize, node.attrs.order, updateAttributes]);

  if (!editor.isEditable) {
    return (
      <NodeViewWrapper
        as="section"
        className="rt-long-text"
        data-node-type="long-text-block"
        contentEditable={false}
      >
        <div className="rt-long-text__header">
          <strong className="rt-long-text__title">
            {attrs.title || "未命名章节"}
          </strong>
          <span className="rt-long-text__meta">
            {value.length.toLocaleString()} 字
          </span>
        </div>
        <div className="rt-long-text__content">{value}</div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="section"
      className="rt-long-text"
      data-node-type="long-text-block"
      contentEditable={false}
    >
      <div className="rt-long-text__header">
        <input
          className="rt-long-text__title"
          value={attrs.title ?? ""}
          onChange={(event) => updateAttributes({ title: event.target.value })}
          placeholder="章节标题"
          aria-label="章节标题"
        />
        <span className="rt-long-text__meta">
          {value.length.toLocaleString()} 字
        </span>
        <button
          type="button"
          className="rt-long-text__split"
          onClick={splitHere}
        >
          从这里切分章节
        </button>
      </div>
      <textarea
        ref={textareaRef}
        className="rt-long-text__editor"
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        placeholder="开始写作…"
        aria-label="长文本正文"
      />
    </NodeViewWrapper>
  );
}
