import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { MAX_CHAPTER_LENGTH } from "./chapter-splitter.js";

/**
 * 长文本块 NodeView。
 *
 * 未选中章节只渲染轻量预览，选中章节才挂载 textarea；切换章节会卸载上一章。
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
  const [titleValue, setTitleValue] = useState(attrs.title ?? "");
  const [isEditing, setIsEditing] = useState(
    selected || editor.state.doc.childCount === 1,
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setValue(attrs.text ?? "");
  }, [attrs.text]);

  useEffect(() => {
    setTitleValue(attrs.title ?? "");
  }, [attrs.title]);

  useEffect(() => {
    setIsEditing(selected);
  }, [selected]);

  useEffect(() => {
    if (isEditing) textareaRef.current?.focus();
  }, [isEditing]);

  const excerpt = useMemo(
    () => value.replace(/\s+/g, " ").slice(0, 120),
    [value],
  );

  // 修改通过引用回调交给宿主，宿主负责写回整体数据；节点属性保持不变。
  const chapterEditHandler = useCallback(
    (patch: { title?: string; text?: string }) => {
      const handler = (
        editor.storage as unknown as {
          longTextBlock?: {
            onChapterEdit?: null | ((
              chapterId: string,
              patch: { title?: string; text?: string },
            ) => void);
          };
        }
      ).longTextBlock?.onChapterEdit;
      handler?.(attrs.chapterId, patch);
    },
    [editor, attrs.chapterId],
  );

  const handleChange = useCallback(
    (next: string) => {
      const limited = next.slice(0, MAX_CHAPTER_LENGTH);
      setValue(limited);
      chapterEditHandler({ text: limited });
    },
    [chapterEditHandler],
  );

  const handleTitleChange = useCallback(
    (next: string) => {
      const limited = next.slice(0, 500);
      setTitleValue(limited);
      chapterEditHandler({ title: limited });
    },
    [chapterEditHandler],
  );

  const splitHere = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || !getPos) return;
    const cursor = textarea.selectionStart ?? textarea.value.length;
    const before = textarea.value.slice(0, cursor);
    const after = textarea.value.slice(cursor);
    if (!after.trim()) return;

    // 宿主已注册切章处理器时由宿主重排章节并重建编辑器（编辑器保持单章节）。
    const splitHandler = (
      editor.storage as unknown as {
        longTextBlock?: {
          onSplit?: null | ((before: string, after: string) => void);
        };
      }
    ).longTextBlock?.onSplit;
    if (splitHandler) {
      splitHandler(before, after);
      return;
    }
    console.warn(
      "[长文本] 切章未找到宿主处理器，走编辑器内插入路径（会导致多节点）",
    );

    // 兜底路径：直接在文档中插入新章节节点。
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
          value={titleValue}
          onChange={(event) => handleTitleChange(event.target.value)}
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
