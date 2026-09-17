/** 标签缓存标识：标签属于整篇文章，键里只有 documentId，没有章节维度。 */
export const tagQueryKeys = {
  /** 一篇文章的标签集合。 */
  document: (documentId: string) => ["documents", documentId, "tags"] as const,
  /** 站点标签字典（服务器标签候选）。 */
  serverDictionary: () => ["forum", "tags"] as const,
};
