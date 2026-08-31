import { MAX_CHAPTER_LENGTH } from "@ricetext/editor-core";
import type { RichTextNode } from "../../../lib/types";
import {
  rawRangeForGapChapter,
  splitRawRangeAtCursor,
} from "./long-text-ranges";

export interface ChapterOperationResult {
  document: RichTextNode;
  activeIndex: number;
}

function chapterNodes(document: RichTextNode): RichTextNode[] {
  return [...(document.content ?? [])] as RichTextNode[];
}

function withNodes(nodes: RichTextNode[]): RichTextNode {
  return { type: "doc", content: nodes };
}

/** 删除指定章节，并把活动索引收敛到删除后的有效范围。 */
export function deleteLongTextChapter(
  document: RichTextNode,
  index: number,
  activeIndex: number,
): ChapterOperationResult | null {
  const nodes = chapterNodes(document);
  if (index < 0 || index >= nodes.length) return null;
  nodes.splice(index, 1);
  return {
    document: withNodes(nodes),
    activeIndex: Math.min(activeIndex, Math.max(0, nodes.length - 1)),
  };
}

/** 把当前章合并到前一章，并延伸原文结束区间。 */
export function mergeLongTextChapter(
  document: RichTextNode,
  index: number,
): ChapterOperationResult | null {
  if (index <= 0) return null;
  const nodes = chapterNodes(document);
  const previous = nodes[index - 1];
  const current = nodes[index];
  if (!previous || !current) return null;
  const previousText = String(previous.attrs?.text ?? "");
  const currentText = String(current.attrs?.text ?? "");
  if (previousText.length + currentText.length + 2 > MAX_CHAPTER_LENGTH)
    return null;

  nodes.splice(index - 1, 2, {
    ...previous,
    attrs: {
      ...previous.attrs,
      text: `${previousText}\n\n${currentText}`,
      end:
        typeof current.attrs?.end === "number"
          ? current.attrs.end
          : typeof previous.attrs?.end === "number"
            ? previous.attrs.end
            : null,
    },
  });
  return { document: withNodes(nodes), activeIndex: index - 1 };
}

/** 移动一个章节并返回移动后所在的活动索引。 */
export function moveLongTextChapter(
  document: RichTextNode,
  from: number,
  to: number,
): ChapterOperationResult | null {
  if (from === to) return null;
  const nodes = chapterNodes(document);
  if (from < 0 || from >= nodes.length || to < 0 || to >= nodes.length)
    return null;
  const [moving] = nodes.splice(from, 1);
  if (!moving) return null;
  nodes.splice(to, 0, moving);
  return { document: withNodes(nodes), activeIndex: to };
}

/** 在文档末尾追加规范化的长文本章节，并限制正文最大长度。 */
export function appendLongTextChapter(
  document: RichTextNode,
  input: {
    chapterId: string;
    title: string;
    text: string;
    start?: number | null;
    end?: number | null;
  },
): ChapterOperationResult {
  const nodes = chapterNodes(document);
  nodes.push({
    type: "longTextBlock",
    attrs: {
      chapterId: input.chapterId,
      title: input.title || "未命名章节",
      text: input.text.slice(0, MAX_CHAPTER_LENGTH),
      order: nodes.length,
      start: input.start ?? null,
      end: input.end ?? null,
    },
  });
  return { document: withNodes(nodes), activeIndex: nodes.length - 1 };
}

/** 把未覆盖的原文片段追加为新章，并根据实际文本修正原文区间。 */
export function appendGapLongTextChapter(
  document: RichTextNode,
  input: { chapterId: string; text: string; start: number; end: number },
): ChapterOperationResult | null {
  if (!input.text.trim()) return null;
  const range = rawRangeForGapChapter(input.start, input.end, input.text);
  return appendLongTextChapter(document, {
    chapterId: input.chapterId,
    title: "未命名章节",
    text: input.text,
    start: range.start,
    end: range.end,
  });
}

/** 在光标位置拆章，同时把原章节的原文区间分配给前后两章。 */
export function splitLongTextChapter(
  document: RichTextNode,
  index: number,
  input: { chapterId: string; before: string; after: string },
): ChapterOperationResult | null {
  const nodes = chapterNodes(document);
  const current = nodes[index];
  if (!current) return null;
  const ranges = splitRawRangeAtCursor(
    current.attrs as Record<string, unknown> | undefined,
    input.before,
    input.after,
  );
  nodes.splice(
    index,
    1,
    {
      ...current,
      attrs: {
        ...current.attrs,
        text: input.before,
        start: ranges.before.start,
        end: ranges.before.end,
      },
    },
    {
      type: "longTextBlock",
      attrs: {
        chapterId: input.chapterId,
        title: `第 ${index + 2} 章`,
        text: input.after,
        order: index + 1,
        start: ranges.after.start,
        end: ranges.after.end,
      },
    },
  );
  return { document: withNodes(nodes), activeIndex: index + 1 };
}

/** 按稳定章节 ID 更新标题或正文，不受章节排序变化影响。 */
export function updateLongTextChapter(
  document: RichTextNode,
  chapterId: string,
  patch: { title?: string; text?: string },
): RichTextNode | null {
  const nodes = chapterNodes(document);
  const index = nodes.findIndex(
    (node) => String(node.attrs?.chapterId) === chapterId,
  );
  const current = nodes[index];
  if (!current || index < 0) return null;
  nodes[index] = {
    ...current,
    attrs: {
      ...current.attrs,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.text !== undefined ? { text: patch.text } : {}),
    },
  };
  return withNodes(nodes);
}
