import type { RichTextNode } from "./types";

/** 内建能力名称；扩展功能可以使用自己的字符串能力，不必修改此联合类型。 */
export const CHAPTER_EDITOR_CAPABILITIES = {
  edit: "chapter.edit",
  save: "chapter.save",
  proofread: "chapter.proofread",
  history: "chapter.history",
  remoteTools: "chapter.remote-tools",
} as const;

export interface ChapterEditingUnit {
  kind: "chapter";
  article: {
    id: string;
    title: string;
    /** 整篇快照的内部并发基线，不作为章节历史编号展示。 */
    baseRevision: number;
  };
  /** 卷目前是文章内的展示分组；没有卷时为 null。 */
  volume: { title: string } | null;
  chapter: {
    id: string | null;
    title: string;
    order: number;
    revision: number;
    savedAt: string;
    registered: boolean;
    source: "document" | "standalone" | "placeholder";
  };
  content: RichTextNode;
  /** 开放字符串集合使新工具可声明能力，而无需扩展中心模型。 */
  capabilities: ReadonlySet<string>;
}

export interface CreateChapterEditingUnitInput {
  articleId: string;
  articleTitle: string;
  baseRevision: number;
  volumeTitle?: string | undefined;
  chapterId?: string | undefined;
  chapterTitle: string;
  chapterOrder: number;
  chapterRevision: number;
  savedAt: string;
  source: ChapterEditingUnit["chapter"]["source"];
  content: RichTextNode;
  capabilities?: Iterable<string>;
}

/** 把页面解析结果收束为稳定的章节编辑边界。 */
export function createChapterEditingUnit(input: CreateChapterEditingUnitInput): ChapterEditingUnit {
  const chapterId = input.chapterId?.trim() || null;
  const volumeTitle = input.volumeTitle?.trim() ?? "";
  return {
    kind: "chapter",
    article: {
      id: input.articleId,
      title: input.articleTitle,
      baseRevision: input.baseRevision,
    },
    volume: volumeTitle ? { title: volumeTitle } : null,
    chapter: {
      id: chapterId,
      title: input.chapterTitle,
      order: input.chapterOrder,
      revision: input.chapterRevision,
      savedAt: input.savedAt,
      registered: chapterId !== null,
      source: input.source,
    },
    content: input.content,
    capabilities: new Set(input.capabilities),
  };
}

export function chapterUnitCan(unit: ChapterEditingUnit, capability: string): boolean {
  return unit.capabilities.has(capability);
}
