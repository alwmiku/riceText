/** 共享缓存标识：位置和版本号始终不用于标识章节。 */
export const chapterQueryKeys = {
  directories: () => ["forum", "chapters"] as const,
  directory: (documentId: string) => ["forum", "chapters", documentId] as const,
  contents: (documentId: string) =>
    ["forum", "chapter-content", documentId] as const,
  content: (documentId: string, chapterId: string | undefined) =>
    ["forum", "chapter-content", documentId, chapterId] as const,
};
