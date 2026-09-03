export {
  chapterTextLines,
  getChapterRange,
  splitDocumentByChapters,
} from "./boundaries.js";
export { appendChapter, removeChapter, replaceChapter } from "./operations.js";
export { chapterStorageId, scopedLongTextChapterId } from "./chapter-identity.js";
export type {
  AppendChapterResult,
  ChapterRange,
  ChapterSection,
  RemoveChapterResult,
  SplitDocument,
} from "./types.js";
