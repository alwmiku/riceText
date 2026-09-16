import type { JSONContent } from "@tiptap/core";

/** 章节及其在完整文档中的节点范围。 */
export interface ChapterSection {
  id: string;
  title: string;
  blocks: JSONContent[];
  start: number;
  end: number;
  /**
   * 身份是否来自节点上持久化的 `chapterId`。
   *
   * false 表示 `id` 只是按位置派生出来的占位（旧文档尚未补铸身份），
   * 不能当作稳定身份使用，也不能参与按 ID 的章节定位。
   */
  explicitIdentity: boolean;
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
