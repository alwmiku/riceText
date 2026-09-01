import { createId } from "../utils";
import { seedRevisions } from "../seed";
import type { DocumentEnvelope, RevisionSummary, RichTextNode } from "../types";
import { api, isServiceUnavailable, rethrowClientError } from "./client";

export async function getRevisions(
  id: string,
  chapterId?: string,
  signal?: AbortSignal,
): Promise<RevisionSummary[]> {
  try {
    return (await api().listRevisions(id, undefined, chapterId, signal)).items;
  } catch (error) {
    if (!isServiceUnavailable(error)) rethrowClientError(error);
    return chapterId ? [] : seedRevisions;
  }
}

export async function getRevision(
  id: string,
  revision: number,
  signal?: AbortSignal,
): Promise<DocumentEnvelope> {
  const envelope = await api().getRevision(id, revision, signal);
  return { ...envelope, content: envelope.content as unknown as RichTextNode };
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
