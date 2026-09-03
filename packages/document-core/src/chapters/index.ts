export {
  chapterTextLines,
  getChapterRange,
  splitDocumentByChapters,
} from "./boundaries.js";
export { appendChapter, removeChapter, replaceChapter } from "./operations.js";
export { chapterStorageId, scopedLongTextChapterId } from "./chapter-identity.js";
export {
  containsLongTextBlocks,
  convertLongTextBlocksToChapters,
} from "./long-text-conversion.js";
export type {
  AppendChapterResult,
  ChapterRange,
  ChapterSection,
  RemoveChapterResult,
  SplitDocument,
} from "./types.js";
