/** Compatibility entrypoint; chapter behavior is owned by document-core. */
export {
  chapterTextLines,
  replaceChapter as mergeChapter,
  splitDocumentByChapters as splitDocumentByHeadings,
} from "@ricetext/document-core";
export type {
  ChapterSection,
  SplitDocument,
} from "@ricetext/document-core";
