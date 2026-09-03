import type { DocumentEnvelope as ContractDocumentEnvelope } from "@ricetext/contracts";
import type { ForumChapterItem, RichTextNode } from "../types";
import { api, isServiceUnavailable, rethrowClientError } from "./client";

export async function listForumChapters(
  documentId: string,
  options?: { strict?: boolean },
): Promise<ForumChapterItem[]> {
  try {
    return (await api().listChapters(documentId)).items;
  } catch (error) {
    if (options?.strict || !isServiceUnavailable(error)) rethrowClientError(error);
    return [];
  }
}

export async function getLongTextChapter(
  documentId: string,
  chapterId: string,
  signal?: AbortSignal,
) {
  return api().getNovelChapter(documentId, chapterId, signal);
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
  try {
    return await api().saveNovelChapter(novelId, chapterId, {
      ...input,
      content: input.content as unknown as ContractDocumentEnvelope["content"],
    });
  } catch (error) {
    rethrowClientError(error);
  }
}

/** 批量章节保存请求项（内容与单章 PUT 一致）。 */
export interface UploadBatchChapterItem {
  id: string;
  title: string;
  order: number;
  content: RichTextNode;
  hash: string;
  baseRevision: number;
}

/** 批量保存章节正文：服务端整批预校验，同 hash 幂等返回 unchanged。 */
export async function uploadLongTextChaptersBatch(
  novelId: string,
  chapters: readonly UploadBatchChapterItem[],
): Promise<{
  chapters: Array<{
    id: string;
    title: string;
    order: number;
    revision: number;
    status: "saved" | "unchanged";
  }>;
}> {
  try {
    return await api().saveNovelChaptersBatch(novelId, {
      chapters: chapters.map((chapter) => ({
        ...chapter,
        content: chapter.content as unknown as ContractDocumentEnvelope["content"],
      })),
    });
  } catch (error) {
    rethrowClientError(error);
  }
}

/** 换序暂存项：仅携带轻量元数据。 */
export interface StageChapterReorderItem {
  id: string;
  temporaryOrder: number;
  baseRevision: number;
}

/** 换序暂存：先把移动章节放到全局唯一临时 order，再执行最终正文批次。 */
export async function stageLongTextChapterReorder(
  novelId: string,
  chapters: readonly StageChapterReorderItem[],
): Promise<{
  chapters: Array<{ id: string; revision: number; status: "staged" | "unchanged" }>;
}> {
  try {
    return await api().stageNovelChapterReorder(novelId, {
      chapters: [...chapters],
    });
  } catch (error) {
    rethrowClientError(error);
  }
}
