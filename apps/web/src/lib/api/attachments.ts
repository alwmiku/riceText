import type { ForumAttachment } from "../types";
import { api, resolveApiUrl } from "./client";

function resolveAttachment(attachment: ForumAttachment): ForumAttachment {
  return {
    ...attachment,
    downloadUrl: resolveApiUrl(attachment.downloadUrl),
  };
}

export async function getAttachment(
  attachmentId: string,
  signal?: AbortSignal,
): Promise<ForumAttachment> {
  return resolveAttachment(await api().getAttachment(attachmentId, signal));
}

export async function purchaseAttachment(
  attachmentId: string,
): Promise<{
  attachment: ForumAttachment;
  buyerBalance: number;
  authorIncome: number;
  alreadyPurchased: boolean;
}> {
  const result = await api().purchaseAttachment(attachmentId);
  return { ...result, attachment: resolveAttachment(result.attachment) };
}
