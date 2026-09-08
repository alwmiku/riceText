import { splitDocumentByHeadings, type ChapterSection } from "./chapters";
import type { ChapterContent, ForumChapterItem, RichTextNode } from "./types";

export interface ChapterIdentity {
  documentId: string;
  id: string;
}

export interface ChapterSource extends ChapterIdentity, ChapterSection {
  order: number;
  volumeTitle: string;
  source: "standalone" | "document" | "placeholder";
  directory?: ForumChapterItem;
  /** 只有旧版位置或显式内嵌 ID 才能建立此关联。 */
  documentChapter?: ChapterSection;
}

export function hasStandaloneChapterContent(
  chapter: ForumChapterItem,
): boolean {
  return chapter.hasContent ?? chapter.revision > 0;
}

export function isBlankDocumentShell(content: RichTextNode): boolean {
  return (content.content ?? []).every(
    (node) => node.type === "paragraph" && (node.content?.length ?? 0) === 0,
  );
}

interface EmbeddedChapter extends ChapterSection {
  explicitIdentity: boolean;
  volumeTitle?: string;
}

function embeddedChapters(content: RichTextNode): EmbeddedChapter[] {
  if (isBlankDocumentShell(content)) return [];
  const nodes = content.content ?? [];
  if (!nodes.some((node) => node.type === "longTextBlock")) {
    return splitDocumentByHeadings(content).chapters.map((chapter) => ({
      ...chapter,
      explicitIdentity: false,
    }));
  }
  const result: EmbeddedChapter[] = [];
  let start = 0;
  const appendOrdinary = (end: number) => {
    if (end === start) return;
    const fragment = { type: "doc", content: nodes.slice(start, end) };
    if (isBlankDocumentShell(fragment)) return;
    for (const chapter of splitDocumentByHeadings(fragment).chapters) {
      result.push({
        ...chapter,
        id: "chapter-" + result.length,
        start: start + chapter.start,
        end: start + chapter.end,
        explicitIdentity: false,
      });
    }
  };
  nodes.forEach((node, index) => {
    if (node.type !== "longTextBlock") return;
    appendOrdinary(index);
    const id = node.attrs?.chapterId;
    result.push({
      id: typeof id === "string" && id ? id : "chapter-" + result.length,
      title: String(node.attrs?.title ?? "正文"),
      volumeTitle: String(node.attrs?.volumeTitle ?? ""),
      blocks: [node],
      start: index,
      end: index + 1,
      explicitIdentity: typeof id === "string" && Boolean(id),
    });
    start = index + 1;
  });
  appendOrdinary(nodes.length);
  return result;
}

/** 解析来源，不发送请求、不访问缓存，也不修改输入文档。
 * 读者投影移除隐藏章节后，会压缩旧版标题的位置。
 * 显式 longTextBlock ID 始终不按位置匹配，即使目录行已移动。
 */
export function resolveChapterSources(input: {
  documentId: string;
  content: RichTextNode;
  directory: readonly ForumChapterItem[];
  includeHidden?: boolean;
  documentIsReaderProjection?: boolean;
  includeUnlistedDocumentChapters?: boolean;
  /** 创作页持有未保存的内嵌编辑内容；阅读页优先使用已确认的独立章节正文。 */
  preferDocumentContent?: boolean;
}): ChapterSource[] {
  const embedded = embeddedChapters(input.content);
  const directory = input.directory
    .filter((row) => row.documentId === input.documentId)
    .sort((a, b) => a.order - b.order);
  const matched = new Set<EmbeddedChapter>();
  const embeddedById = new Map<string, EmbeddedChapter>();
  for (const chapter of embedded) {
    if (chapter.explicitIdentity) embeddedById.set(chapter.id, chapter);
  }
  const projected = input.documentIsReaderProjection === true;
  const projectionRows = directory.filter((row) => !row.hidden);
  const projectedPositions = new Map(
    projectionRows.map((row, index) => [row.id, index]),
  );
  const legacy = embedded.every((chapter) => !chapter.explicitIdentity);
  const sources: ChapterSource[] = directory.map((row) => {
    let chapter = embeddedById.get(row.id);
    if (!chapter && legacy) {
      // 只有完整的投影目录才能确认压缩后的旧版位置映射。
      const position = projected
        ? embedded.length === projectionRows.length
          ? (projectedPositions.get(row.id) ?? -1)
          : -1
        : row.order;
      chapter = embedded[position];
    }
    if (chapter) matched.add(chapter);
    const source =
      chapter && input.preferDocumentContent
        ? "document"
        : hasStandaloneChapterContent(row)
          ? "standalone"
          : chapter
            ? "document"
            : "placeholder";
    return {
      documentId: input.documentId,
      id: row.id,
      title: row.title,
      order: row.order,
      volumeTitle: row.volumeTitle ?? "",
      source,
      directory: row,
      ...(chapter ? { documentChapter: chapter } : {}),
      blocks: source === "document" ? chapter!.blocks : [],
      start: chapter?.start ?? row.order,
      end: chapter?.end ?? row.order + 1,
    };
  });
  if (directory.length === 0 || input.includeUnlistedDocumentChapters) {
    const sourceIds = new Set(sources.map((source) => source.id));
    embedded.forEach((chapter, order) => {
      if (matched.has(chapter) || sourceIds.has(chapter.id)) return;
      sourceIds.add(chapter.id);
      sources.push({
        ...chapter,
        documentId: input.documentId,
        order,
        volumeTitle: chapter.volumeTitle ?? "",
        source: "document",
        documentChapter: chapter,
      });
    });
  }
  return sources.filter(
    (source) => input.includeHidden || !source.directory?.hidden,
  );
}

export type ResolvedChapterContent =
  | { source: "standalone" | "document"; content: RichTextNode }
  | { source: "placeholder" | "loading" | "error"; content?: never };

/** 独立章节请求失败时，绝不能显示按位置回退的内容或其他实体。 */
export function resolveChapterContent(
  chapter: ChapterSource | undefined,
  request: { data?: ChapterContent | undefined; isError?: boolean } = {},
): ResolvedChapterContent {
  if (!chapter || chapter.source === "placeholder")
    return { source: "placeholder" };
  if (chapter.source === "document") {
    return {
      source: "document",
      content: { type: "doc", content: chapter.blocks },
    };
  }
  if (request.isError) return { source: "error" };
  if (
    request.data &&
    request.data.id === chapter.id &&
    request.data.documentId === chapter.documentId
  ) {
    return { source: "standalone", content: request.data.content };
  }
  if (request.data) return { source: "error" };
  return { source: "loading" };
}
