import type { DocumentEnvelope as ContractDocumentEnvelope } from "@ricetext/contracts";
import type { ForumChapterItem, RichTextNode } from "../types";
import { api, isServiceUnavailable, rethrowClientError } from "./client";

export async function listForumChapters(
  documentId: string,
): Promise<ForumChapterItem[]> {
  try {
    return (await api().listChapters(documentId)).items;
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

/**
 * 注册正文中已出现但目录缺失的新章节：服务端分配并返回章节 id，
 * 调用方应把它同步回本地章节目录（保存与历史都使用该服务器 id）。
 */
export async function createDocumentChapter(
  documentId: string,
  input: { title: string; order: number },
): Promise<ForumChapterItem> {
  return api().createDocumentChapter(documentId, input);
}

/**
 * 删除章节目录行（幂等）：编辑器「删除章节」把章节移出正文后调用，
 * 历史修订与章节版本号不受影响。
 */
export async function deleteDocumentChapter(
  documentId: string,
  chapterId: string,
): Promise<{ id: string; deleted: boolean }> {
  return api().deleteDocumentChapter(documentId, chapterId);
}

/**
 * 隐藏/恢复章节：隐藏后读者不可读，作者写完取消隐藏后恢复可读。
 */
export async function setDocumentChapterHidden(
  documentId: string,
  chapterId: string,
  hidden: boolean,
): Promise<ForumChapterItem> {
  return api().updateDocumentChapter(documentId, chapterId, { hidden });
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
