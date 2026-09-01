import type { ForumPoll } from "../types";
import { api } from "./client";

export async function getPoll(
  pollId: string,
  signal?: AbortSignal,
): Promise<ForumPoll> {
  return api().getPoll(pollId, signal);
}

export async function votePoll(
  pollId: string,
  optionIds: string[],
): Promise<ForumPoll> {
  return api().submitPollVote(pollId, optionIds);
}

export async function getPollVotes(
  pollId: string,
  cursor?: string,
): Promise<{
  items: Array<{
    user: { id: string; name: string; role: string };
    optionIds: string[];
    createdAt: string;
  }>;
  pageInfo: { nextCursor: string | null };
}> {
  return api().listPollVotes(pollId, cursor);
}
