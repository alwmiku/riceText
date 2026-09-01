import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getPoll, getPollVotes, votePoll } from "../../lib/api/polls";
import { forumQueryKeys } from "./query-keys";

type PollVote = Awaited<ReturnType<typeof getPollVotes>>["items"][number];

export function usePoll(pollId: string) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [detailItems, setDetailItems] = useState<PollVote[]>([]);
  const pollQuery = useQuery({
    queryKey: forumQueryKeys.poll(pollId),
    queryFn: ({ signal }) => getPoll(pollId, signal),
  });
  const voteMutation = useMutation({
    mutationFn: (optionId: string) => votePoll(pollId, [optionId]),
  });

  const choose = async (optionId: string) => {
    if (!pollQuery.data || voteMutation.isPending) return;
    setError("");
    try {
      const updated = await voteMutation.mutateAsync(optionId);
      queryClient.setQueryData(forumQueryKeys.poll(pollId), updated);
      await queryClient.invalidateQueries({
        queryKey: forumQueryKeys.poll(pollId),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "投票失败");
    }
  };

  const loadDetail = async () => {
    if (detailItems.length !== 0) return;
    try {
      const result = await getPollVotes(pollId);
      setDetailItems(result.items);
    } catch {
      setDetailItems([]);
    }
  };

  return {
    poll: pollQuery.data,
    isLoading: pollQuery.isLoading,
    error,
    detailItems,
    isVoting: voteMutation.isPending,
    choose,
    loadDetail,
  };
}
