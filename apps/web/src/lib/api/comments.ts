import { seedComments } from "../seed";
import type { CommentReply } from "../types";
import { api, isServiceUnavailable, rethrowClientError } from "./client";

export async function getCommentThread(
  documentId: string,
  anchorId: string,
): Promise<CommentReply[]> {
  try {
    return (await api().getCommentThread(documentId, anchorId, "score")).items;
  } catch (error) {
    if (!isServiceUnavailable(error)) rethrowClientError(error);
    return structuredClone(seedComments);
  }
}

export async function voteComment(
  commentId: string,
  vote: -1 | 0 | 1,
): Promise<{ upvotes: number; downvotes: number; myVote: -1 | 0 | 1 }> {
  try {
    const result = await api().voteComment(commentId, vote);
    return {
      upvotes: result.upvotes,
      downvotes: result.downvotes,
      myVote: result.myVote,
    };
  } catch {
    return {
      upvotes: 8 + (vote === 1 ? 1 : 0),
      downvotes: vote === -1 ? 1 : 0,
      myVote: vote,
    };
  }
}
