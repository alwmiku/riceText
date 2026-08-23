import { useCallback, useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { MAX_CHAPTER_LENGTH } from "./chapter-splitter.js";

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
  selected,
}: NodeViewProps) {
  const attrs = node.attrs as unknown as {
    chapterId: string;
    title: string;
    text: string;
    order: number;
  };
  const [value, setValue] = useState(attrs.text ?? "");
  const [isEditing, setIsEditing] = useState(selected);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    setValue(attrs.text ?? "");
  }, [attrs.text]);

  useEffect(() => {
    setIsEditing(selected);
  }, [selected]);

  useEffect(() => {
    if (isEditing) textareaRef.current?.focus();
  }, [isEditing]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleChange = useCallback(
    (next: string) => {
      const limited = next.slice(0, MAX_CHAPTER_LENGTH);
      setValue(limited);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        updateAttributes({ text: limited });
      }, 300);
    },
    [updateAttributes],
  );

  const splitHere = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || !getPos) return;
    const cursor = textarea.selectionStart ?? textarea.value.length;
    const before = textarea.value.slice(0, cursor);
    const after = textarea.value.slice(cursor);
    if (!after.trim()) return;

    updateAttributes({ text: before });

    const pos = getPos();
    if (pos === undefined) return;
    const insertAt = pos + node.nodeSize;
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
        data-chapter-id={attrs.chapterId}
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

  if (!isEditing) {
    const excerpt = value.replace(/\s+/g, " ").slice(0, 120);
    return (
      <NodeViewWrapper
        as="section"
        className="rt-long-text rt-long-text--preview"
        data-node-type="long-text-block"
        data-chapter-id={attrs.chapterId}
        contentEditable={false}
      >
        <button
          type="button"
          className="rt-long-text__preview"
          onClick={() => setIsEditing(true)}
          aria-label={`编辑章节 ${attrs.title || "未命名章节"}`}
        >
          <strong className="rt-long-text__title">
            {attrs.title || "未命名章节"}
          </strong>
          <span className="rt-long-text__meta">
            {value.length.toLocaleString()} 字
          </span>
          {excerpt && <span className="rt-long-text__excerpt">{excerpt}</span>}
        </button>
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
          {value.length.toLocaleString()} / {MAX_CHAPTER_LENGTH.toLocaleString()} 字
        </span>
        <button
          type="button"
          className="rt-long-text__split"
          onClick={splitHere}
          title="在当前光标位置创建新章节"
        >
          光标处切章
        </button>
      </div>
      <textarea
        ref={textareaRef}
        className="rt-long-text__editor"
        value={value}
        maxLength={MAX_CHAPTER_LENGTH}
        onChange={(event) => handleChange(event.target.value)}
        placeholder="开始写作…"
        aria-label="长文本正文"
      />
    </NodeViewWrapper>
  );
}
