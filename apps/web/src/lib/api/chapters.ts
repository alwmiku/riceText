import type { DocumentEnvelope as ContractDocumentEnvelope } from "@ricetext/contracts";
import type { ForumChapterItem, RichTextNode } from "../types";
import { api, isServiceUnavailable, rethrowClientError } from "./client";

export async function listForumChapters(): Promise<ForumChapterItem[]> {
  try {
    return (await api().listChapters()).items;
  } catch (error) {
    if (!isServiceUnavailable(error)) rethrowClientError(error);
    return [];
  }
}

export interface ChapterSyncItem {
  id: string;
  title: string;
  order: number;
  /** SHA-256 hash of the chapter body. */
  hash: string;
}

export async function syncLongTextChapters(
  novelId: string,
  chapters: readonly ChapterSyncItem[],
): Promise<{ toUpdate: string[]; existing: string[] }> {
  return api().syncNovelChapters(novelId, [...chapters]);
}

export async function uploadLongTextChapter(
  novelId: string,
  chapterId: string,
  input: {
    title: string;
    order: number;
    content: RichTextNode;
    hash: string;
    baseRevision: number;
  },
): Promise<{ id: string; title: string; order: number; revision: number }> {
  return api().saveNovelChapter(novelId, chapterId, {
    ...input,
    content: input.content as unknown as ContractDocumentEnvelope["content"],
  });
}
