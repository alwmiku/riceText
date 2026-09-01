import { createId } from "../utils";
import { seedRevisions } from "../seed";
import type { DocumentEnvelope, RevisionSummary, RichTextNode } from "../types";
import { api, isServiceUnavailable, rethrowClientError } from "./client";

export async function getRevisions(
  id: string,
  signal?: AbortSignal,
): Promise<RevisionSummary[]> {
  try {
    return (await api().listRevisions(id, undefined, signal)).items;
  } catch (error) {
    if (!isServiceUnavailable(error)) rethrowClientError(error);
    return seedRevisions;
  }
}

export async function restoreRevision(
  id: string,
  revision: number,
  baseRevision: number,
): Promise<DocumentEnvelope> {
  const envelope = await api().rollbackDocument(id, {
    targetRevision: revision,
    baseRevision,
    clientMutationId: createId("restore"),
  });
  return { ...envelope, content: envelope.content as unknown as RichTextNode };
}
