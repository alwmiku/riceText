import type { JSONContent } from "@tiptap/core";

/** 章节及其在完整文档中的节点范围。 */
export interface ChapterSection {
  id: string;
  title: string;
  blocks: JSONContent[];
  start: number;
  end: number;
}

export interface SplitDocument {
  lead: JSONContent[];
  chapters: ChapterSection[];
}

export interface ChapterRange {
  start: number;
  end: number;
}

export interface AppendChapterResult {
  document: JSONContent;
  chapter: ChapterSection;
  index: number;
}

export interface RemoveChapterResult {
  document: JSONContent;
  removed: ChapterSection | null;
}
