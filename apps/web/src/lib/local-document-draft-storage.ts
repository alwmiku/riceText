import type { RichTextNode } from "./types";

export interface LocalDocumentDraft {
  documentId: string;
  baseRevision: number;
  content: RichTextNode;
  savedAt: string;
}

const key = (documentId: string) => `ricetext:draft:${documentId}`;

/** 自动保存当前编辑快照到浏览器本地，不触发任何网络请求。 */
export function saveLocalDocumentDraft(draft: LocalDocumentDraft): void {
  localStorage.setItem(key(draft.documentId), JSON.stringify(draft));
}

/** 读取结构完整的本地草稿；损坏数据会被忽略。 */
export function loadLocalDocumentDraft(
  documentId: string,
): LocalDocumentDraft | null {
  const raw = localStorage.getItem(key(documentId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LocalDocumentDraft>;
    if (
      value.documentId !== documentId ||
      !Number.isInteger(value.baseRevision) ||
      typeof value.savedAt !== "string" ||
      value.content?.type !== "doc"
    )
      return null;
    return value as LocalDocumentDraft;
  } catch {
    return null;
  }
}

/** 服务端确认保存后删除已同步的本地草稿。 */
export function clearLocalDocumentDraft(documentId: string): void {
  localStorage.removeItem(key(documentId));
}
