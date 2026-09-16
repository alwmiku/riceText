import { MAX_CHAPTER_LENGTH } from "@ricetext/editor-core";
import type { RichTextNode } from "../../../lib/types";
import {
  rawRangeForGapChapter,
  splitRawRangeAtCursor,
} from "./long-text-ranges";

export interface ChapterOperationResult {
  document: RichTextNode;
  /** 操作后应激活的章节身份（稳定 ID，不是位置）。 */
  activeChapterId: string;
}

function chapterNodes(document: RichTextNode): RichTextNode[] {
  return [...(document.content ?? [])] as RichTextNode[];
}

/** 章节在草稿正文中的位置；位置只用于渲染与选择，命令一律按稳定 ID 寻址。 */
export function longTextChapterIndex(document: RichTextNode, chapterId: string): number {
  return chapterNodes(document).findIndex(
    (node) => String(node.attrs?.chapterId) === chapterId,
  );
}

/** 列表位置 → 稳定章节 ID；调用方只应在渲染/选择边界使用它。 */
export function longTextChapterIdAt(document: RichTextNode, index: number): string | undefined {
  const value = chapterNodes(document)[index]?.attrs?.chapterId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function withNodes(nodes: RichTextNode[]): RichTextNode {
  return { type: "doc", content: nodes };
}

/** 删除指定章节；返回删除后仍然有效的活动章节身份。 */
export function deleteLongTextChapter(
  document: RichTextNode,
  chapterId: string,
  activeChapterId: string,
): ChapterOperationResult | null {
  const nodes = chapterNodes(document);
  const index = nodes.findIndex((node) => String(node.attrs?.chapterId) === chapterId);
  if (index < 0) return null;
  nodes.splice(index, 1);
  if (nodes.length === 0) return null;
  const stillThere = nodes.some((node) => String(node.attrs?.chapterId) === activeChapterId);
  const fallback = nodes[Math.min(index, nodes.length - 1)]!;
  return {
    document: withNodes(nodes),
    activeChapterId: stillThere ? activeChapterId : String(fallback.attrs?.chapterId ?? ""),
  };
}

/** 把指定章节合并到前一章，并延伸原文结束区间。 */
export function mergeLongTextChapter(
  document: RichTextNode,
  chapterId: string,
): ChapterOperationResult | null {
  const nodes = chapterNodes(document);
  const index = nodes.findIndex((node) => String(node.attrs?.chapterId) === chapterId);
  if (index <= 0) return null;
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
  return { document: withNodes(nodes), activeChapterId: String(previous.attrs?.chapterId ?? "") };
}

/**
 * 把一个章节移动到 `targetChapterId` 当前所在的位置。
 *
 * 命令按稳定 ID 寻址（拖拽目标与上下移都表达为「移到哪一章」），
 * 语义与旧的位置版一致：先摘出再按目标索引插入，因此支持任意跨度移动。
 */
export function moveLongTextChapter(
  document: RichTextNode,
  chapterId: string,
  targetChapterId: string,
): ChapterOperationResult | null {
  const nodes = chapterNodes(document);
  const from = nodes.findIndex((node) => String(node.attrs?.chapterId) === chapterId);
  const to = nodes.findIndex((node) => String(node.attrs?.chapterId) === targetChapterId);
  if (from < 0 || to < 0 || from === to) return null;
  const [moving] = nodes.splice(from, 1);
  if (!moving) return null;
  nodes.splice(to, 0, moving);
  return { document: withNodes(nodes), activeChapterId: chapterId };
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
  return {
    document: withNodes(nodes),
    activeChapterId: String(nodes[nodes.length - 1]!.attrs?.chapterId ?? ""),
  };
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
  chapterId: string,
  input: { chapterId: string; before: string; after: string },
): ChapterOperationResult | null {
  const nodes = chapterNodes(document);
  const index = nodes.findIndex((node) => String(node.attrs?.chapterId) === chapterId);
  const current = nodes[index];
  if (index < 0 || !current) return null;
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
  return { document: withNodes(nodes), activeChapterId: input.chapterId };
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
