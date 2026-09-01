import type { JSONContent } from "@tiptap/core";

/** A chapter and its node range in the full document. */
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
