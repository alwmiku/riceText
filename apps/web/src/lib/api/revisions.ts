import { createEntityId } from "@ricetext/contracts";
import type { DocumentEnvelope, RevisionSummary, RichTextNode } from "../types";
import { api, isServiceUnavailable, rethrowClientError } from "./client";

export async function getRevisions(
  id: string,
  chapterId: string,
  signal?: AbortSignal,
): Promise<RevisionSummary[]> {
  try {
    return (await api().listRevisions(id, chapterId, undefined, signal)).items;
  } catch (error) {
    if (!isServiceUnavailable(error)) rethrowClientError(error);
    return [];
  }
}

export async function getRevision(
  id: string,
  chapterId: string,
  revision: number,
  signal?: AbortSignal,
): Promise<DocumentEnvelope> {
  const envelope = await api().getRevision(id, revision, chapterId, signal);
  return { ...envelope, content: envelope.content as unknown as RichTextNode };
}

export async function restoreRevision(
  id: string,
  chapterId: string,
  revision: number,
  baseRevision: number,
): Promise<DocumentEnvelope> {
  const envelope = await api().rollbackDocument(id, {
    targetRevision: revision,
    baseRevision,
    chapterId,
    clientMutationId: createEntityId("mutation"),
  });
  return { ...envelope, content: envelope.content as unknown as RichTextNode };
}
