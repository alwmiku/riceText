import { useQuery } from "@tanstack/react-query";
import { getRevisions } from "../../lib/api/revisions";
import { forumQueryKeys } from "./query-keys";

export function useRevisions(documentId: string) {
  const revisionsQuery = useQuery({
    queryKey: forumQueryKeys.revisions(documentId),
    queryFn: ({ signal }) => getRevisions(documentId, signal),
  });

  return {
    revisions: revisionsQuery.data ?? [],
    isLoading: revisionsQuery.isLoading,
    error: revisionsQuery.error,
  };
}
