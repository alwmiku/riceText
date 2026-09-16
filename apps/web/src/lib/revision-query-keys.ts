/** 章节历史缓存键；article 用于失效整篇下所有章节，chapter 用于精确读取。 */
export const revisionQueryKeys = {
  all: ["revisions"] as const,
  article: (articleId: string) => ["revisions", articleId] as const,
  chapter: (articleId: string, chapterId: string) => ["revisions", articleId, chapterId] as const,
};
