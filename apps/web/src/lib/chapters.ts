/** 兼容入口；章节行为由 document-core 负责。 */
export {
  chapterTextLines,
  replaceChapter as mergeChapter,
  splitDocumentByChapters as splitDocumentByHeadings,
} from "@ricetext/document-core";
export type {
  ChapterSection,
  SplitDocument,
} from "@ricetext/document-core";
