import type { DocumentListItem } from "@ricetext/contracts";
import { api, isServiceUnavailable, rethrowClientError } from "./client";

/** 文章选择器只在已登录后调用；网络不可用时返回空列表。 */
export async function listDocuments(): Promise<DocumentListItem[]> {
  try {
    return (await api().listDocuments()).items;
  } catch (error) {
    if (!isServiceUnavailable(error)) rethrowClientError(error);
    return [];
  }
}
