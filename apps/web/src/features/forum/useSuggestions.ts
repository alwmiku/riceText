import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listSuggestionBatches,
  listSuggestions,
  reviewSuggestionBatch,
  reviewSuggestion,
} from "../../lib/api/suggestions";
import type { ForumSuggestionBatch } from "../../lib/types";
import { forumQueryKeys } from "./query-keys";

export function useSuggestions(documentId: string, baseRevision: number) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const suggestionsQuery = useQuery({
    queryKey: forumQueryKeys.suggestions(documentId),
    queryFn: ({ signal }) => listSuggestions(documentId, signal),
  });
  const batchesQuery = useQuery({
    queryKey: forumQueryKeys.suggestionBatches(documentId),
    queryFn: ({ signal }) => listSuggestionBatches(documentId, signal),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" }) =>
      reviewSuggestion(id, decision, baseRevision),
  });
  const reviewBatchMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" }) =>
      reviewSuggestionBatch(id, decision, baseRevision),
  });

  const decide = async (id: string, decision: "approve" | "reject") => {
    setBusyId(id);
    setError("");
    try {
      await reviewMutation.mutateAsync({ id, decision });
      await queryClient.invalidateQueries({
        queryKey: forumQueryKeys.suggestions(documentId),
      });
      // 接受会合并正文并创建新修订：刷新文档与历史。
      await queryClient.invalidateQueries({
        queryKey: forumQueryKeys.document(documentId),
      });
      await queryClient.invalidateQueries({
        queryKey: forumQueryKeys.revisions(documentId),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "审核失败");
    } finally {
      setBusyId(null);
    }
  };

  const decideBatch = async (id: string, decision: "approve" | "reject") => {
    setBusyId(id);
    setError("");
    try {
      const result = await reviewBatchMutation.mutateAsync({ id, decision });
      queryClient.setQueryData<ForumSuggestionBatch[]>(
        forumQueryKeys.suggestionBatches(documentId),
        (current = []) =>
          current.map((item) => (item.id === id ? result.batch : item)),
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: forumQueryKeys.suggestionBatches(documentId),
        }),
        queryClient.invalidateQueries({
          queryKey: forumQueryKeys.document(documentId),
        }),
        queryClient.invalidateQueries({
          queryKey: forumQueryKeys.revisions(documentId),
        }),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "批量审核失败");
    } finally {
      setBusyId(null);
    }
  };

  return {
    items: suggestionsQuery.data ?? [],
    batches: batchesQuery.data ?? [],
    isLoading: suggestionsQuery.isLoading || batchesQuery.isLoading,
    busyId,
    error,
    decide,
    decideBatch,
  };
}
