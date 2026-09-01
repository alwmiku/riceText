import type { DocumentEnvelope as ContractDocumentEnvelope } from "@ricetext/contracts";
import {
  applyStepsToDocument,
  sharedSchema,
  type JSONContent,
  type StepJson,
} from "@ricetext/document-core";
import { readCachedDocument, writeCachedDocument } from "../offline/document-cache";
import type { DocumentEnvelope, RichTextNode } from "../types";
import {
  api,
  isApiClientError,
  isServiceUnavailable,
  rethrowClientError,
} from "./client";

/** Read the server document, then fall back to local cache and the built-in seed. */
export async function getDocument(
  id: string,
  signal?: AbortSignal,
): Promise<DocumentEnvelope> {
  try {
    const envelope = await api().getDocument(id, signal);
    return {
      ...envelope,
      content: envelope.content as unknown as RichTextNode,
      storage: "server",
    };
  } catch (error) {
    if (!isServiceUnavailable(error)) rethrowClientError(error);
    return readCachedDocument(id);
  }
}

export async function saveDocument(
  id: string,
  input: {
    schemaVersion: number;
    baseRevision: number;
    clientMutationId: string;
    content: RichTextNode;
    chapterId?: string;
  },
): Promise<DocumentEnvelope> {
  try {
    const envelope = await api().updateDocument(id, {
      ...input,
      content: input.content as unknown as ContractDocumentEnvelope["content"],
    });
    return {
      ...envelope,
      content: envelope.content as unknown as RichTextNode,
      storage: "server",
    };
  } catch (error) {
    if (isApiClientError(error)) rethrowClientError(error);
    const current = await getDocument(id);
    const saved: DocumentEnvelope = {
      ...current,
      content: input.content,
      revision: Math.max(current.revision, input.baseRevision) + 1,
      savedAt: new Date().toISOString(),
      storage: "local-cache",
    };
    writeCachedDocument(id, saved);
    return saved;
  }
}

export async function saveDocumentSteps(
  id: string,
  input: {
    schemaVersion: number;
    baseRevision: number;
    clientMutationId: string;
    steps: StepJson[];
    chapterId?: string;
  },
): Promise<DocumentEnvelope> {
  try {
    const envelope = await api().updateDocumentSteps(id, {
      ...input,
      steps: input.steps as unknown as Array<Record<string, unknown>>,
    });
    return {
      ...envelope,
      content: envelope.content as unknown as RichTextNode,
      storage: "server",
    };
  } catch (error) {
    if (isApiClientError(error)) rethrowClientError(error);
    const current = await getDocument(id);
    let content: RichTextNode = current.content;
    try {
      content = applyStepsToDocument(
        sharedSchema(),
        current.content as unknown as JSONContent,
        input.steps,
      ) as RichTextNode;
    } catch {
      // Keep the current content when local step application cannot be parsed.
    }
    const saved: DocumentEnvelope = {
      ...current,
      content,
      revision: Math.max(current.revision, input.baseRevision) + 1,
      savedAt: new Date().toISOString(),
      storage: "local-cache",
    };
    writeCachedDocument(id, saved);
    return saved;
  }
}
