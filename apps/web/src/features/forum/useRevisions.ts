import { useQuery } from "@tanstack/react-query";
import { getRevisions } from "../../lib/api/revisions";
import { revisionQueryKeys } from "../../lib/revision-query-keys";

export function useRevisions(documentId: string, chapterId?: string) {
  // 章节尚未在服务器目录注册（新建后未保存）：不发起查询，历史视为暂无。
  const chapterRegistered = Boolean(chapterId);
  const revisionsQuery = useQuery({
    queryKey: chapterId
      ? revisionQueryKeys.chapter(documentId, chapterId)
      : revisionQueryKeys.article(documentId),
    queryFn: ({ signal }) => getRevisions(documentId, chapterId!, signal),
    enabled: chapterRegistered,
  });

  return {
    revisions: chapterRegistered ? (revisionsQuery.data ?? []) : [],
    isLoading: revisionsQuery.isLoading,
    error: revisionsQuery.error,
  };
}
