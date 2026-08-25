import type { JSONContent } from "@ricetext/editor-core";

/** 切分后的单个章节：标题与文档中的节点区间。 */
export interface ChapterSection {
  id: string;
  /** 章节完整标题（h2 文本）。 */
  title: string;
  /** 该章节的所有节点（含章节标题节点）。 */
  blocks: JSONContent[];
  /** 在文档 content 数组中的起始索引。 */
  start: number;
  /** 结束索引（不含）。 */
  end: number;
}

export interface SplitDocument {
  /** 章节标题之前的内容（如书名 h1）。 */
  lead: JSONContent[];
  chapters: ChapterSection[];
}

function extractText(node: JSONContent): string {
  return (node.content ?? [])
    .map((child) => (child.type === "text" && typeof child.text === "string" ? child.text : ""))
    .join("")
    .trim();
}

/**
 * 按二级标题把文档切分为章节。
 * 没有二级标题时整个文档视为单章，保证编辑器/阅读器始终有一个可编辑片段。
 */
export function splitDocumentByHeadings(doc: JSONContent): SplitDocument {
  const content = doc.content ?? [];
  const chapters: ChapterSection[] = [];
  const lead: JSONContent[] = [];
  let current: ChapterSection | null = null;

  content.forEach((node, index) => {
    const isChapterHeading = node.type === "heading" && node.attrs?.level === 2;
    if (isChapterHeading) {
      if (current) current.end = index;
      current = {
        id: `chapter-${chapters.length}`,
        title: extractText(node),
        blocks: [node],
        start: index,
        end: index + 1,
      };
      chapters.push(current);
    } else if (current) {
      current.blocks.push(node);
      current.end = index + 1;
    } else {
      lead.push(node);
    }
  });

  if (chapters.length === 0) {
    return {
      lead: [],
      chapters: [
        {
          id: "chapter-0",
          title: "正文",
          blocks: content,
          start: 0,
          end: content.length,
        },
      ],
    };
  }
  return { lead, chapters };
}

/** 用编辑器返回的章节片段替换完整文档中对应章节的节点区间。 */
export function mergeChapter(
  full: JSONContent,
  index: number,
  nextDoc: JSONContent,
): JSONContent {
  const { chapters } = splitDocumentByHeadings(full);
  const chapter = chapters[index];
  if (!chapter) return full;
  const content = [...(full.content ?? [])];
  content.splice(chapter.start, chapter.end - chapter.start, ...(nextDoc.content ?? []));
  return { type: "doc", content };
}

/** 递归收集节点内的全部文本（跳过无文本节点，如骰子/图片）。 */
function collectNodeText(node: JSONContent): string {
  if (node.type === "text" && typeof node.text === "string") return node.text;
  return (node.content ?? []).map(collectNodeText).join("");
}

/**
 * 把章节节点按块拆为“行”文本：每个块（段落/标题/摘录等）一行，
 * 行号 = 数组下标 + 1，与服务端校订建议的 lineNo 约定一致。
 */
export function chapterTextLines(blocks: readonly JSONContent[]): string[] {
  return blocks.map((block) => collectNodeText(block));
}
