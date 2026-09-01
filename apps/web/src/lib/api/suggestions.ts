import type { DocumentEnvelope as ContractDocumentEnvelope } from "@ricetext/contracts";
import { seedSuggestions } from "../seed";
import type {
  DocumentEnvelope,
  ForumSuggestionBatch,
  ForumSuggestion,
  RichTextNode,
} from "../types";
import { api, isServiceUnavailable, rethrowClientError } from "./client";

export async function listSuggestions(
  documentId: string,
  signal?: AbortSignal,
): Promise<ForumSuggestion[]> {
  try {
    return (await api().listSuggestions(documentId, signal)).items;
  } catch (error) {
    if (!isServiceUnavailable(error)) rethrowClientError(error);
    return structuredClone(seedSuggestions);
  }
}

export async function submitSuggestion(
  documentId: string,
  input: {
    fromText: string;
    toText: string;
    reason: string;
    chapterId: string;
    chapterTitle: string;
    lineNo: number;
    lineText: string;
  },
): Promise<ForumSuggestion> {
  return api().createSuggestion(documentId, input);
}

export async function reviewSuggestion(
  suggestionId: string,
  decision: "approve" | "reject",
  baseRevision: number,
): Promise<{ suggestion: ForumSuggestion; document: DocumentEnvelope | null }> {
  const result = await api().reviewSuggestion(suggestionId, { decision, baseRevision });
  return {
    suggestion: result.suggestion,
    document: result.document
      ? { ...result.document, content: result.document.content as unknown as RichTextNode }
      : null,
  };
}

export async function listSuggestionBatches(
  documentId: string,
  signal?: AbortSignal,
): Promise<ForumSuggestionBatch[]> {
  return (await api().listSuggestionBatches(documentId, signal)).items;
}

export async function submitSuggestionBatch(
  documentId: string,
  input: {
    baseRevision: number;
    chapterId: string;
    chapterTitle: string;
    beforeContent: ContractDocumentEnvelope["content"];
    afterContent: ContractDocumentEnvelope["content"];
    steps: Array<Record<string, unknown>>;
    reason: string;
  },
): Promise<ForumSuggestionBatch> {
  return api().createSuggestionBatch(documentId, input);
}

export async function reviewSuggestionBatch(
  batchId: string,
  decision: "approve" | "reject",
  baseRevision: number,
): Promise<{ batch: ForumSuggestionBatch; document: DocumentEnvelope | null }> {
  const result = await api().reviewSuggestionBatch(batchId, {
    decision,
    baseRevision,
  });
  return {
    batch: result.batch,
    document: result.document
      ? {
          ...result.document,
          content: result.document.content as unknown as RichTextNode,
        }
      : null,
  };
}
