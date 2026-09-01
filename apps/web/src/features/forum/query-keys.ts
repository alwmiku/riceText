export const forumQueryKeys = {
  suggestions: (documentId: string) => ["forum", "suggestions", documentId] as const,
  suggestionBatches: (documentId: string) =>
    ["forum", "suggestion-batches", documentId] as const,
  attachment: (attachmentId: string) =>
    ["forum", "attachment", attachmentId] as const,
  poll: (pollId: string) => ["forum", "poll", pollId] as const,
  revisions: (documentId: string, chapterId?: string) =>
    ["revisions", documentId, chapterId ?? "all"] as const,
  document: (documentId: string) => ["document", documentId] as const,
};
