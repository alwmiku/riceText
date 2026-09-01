import type { ForumAttachment } from "../types";
import { api } from "./client";

export async function getAttachment(
  attachmentId: string,
  signal?: AbortSignal,
): Promise<ForumAttachment> {
  return api().getAttachment(attachmentId, signal);
}

export async function purchaseAttachment(
  attachmentId: string,
): Promise<{
  attachment: ForumAttachment;
  buyerBalance: number;
  authorIncome: number;
  alreadyPurchased: boolean;
}> {
  return api().purchaseAttachment(attachmentId);
}
