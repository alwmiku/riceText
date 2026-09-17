import type { DocumentTag, Tag } from "@ricetext/contracts";
import { api, rethrowClientError } from "./client";

/**
 * 读取整篇文章的标签。
 *
 * 作者身份会额外拿到已隐藏的服务器标签（自己的文章要看得见），读者只拿到可展示标签；
 * 这个区别由服务端按编辑权决定，前端不做二次过滤。
 */
export async function getDocumentTags(
  documentId: string,
  signal?: AbortSignal,
): Promise<DocumentTag[]> {
  try {
    return (await api().listDocumentTags(documentId, signal)).items;
  } catch (error) {
    rethrowClientError(error);
  }
}

/** 全量替换文章标签；来源（服务器/自建）由服务端按字典解析。 */
export async function saveDocumentTags(
  documentId: string,
  labels: readonly string[],
): Promise<DocumentTag[]> {
  try {
    return (
      await api().updateDocumentTags(documentId, {
        items: labels.map((label) => ({ label })),
      })
    ).items;
  } catch (error) {
    rethrowClientError(error);
  }
}

/** 读取站点标签字典（不含已隐藏条目）。 */
export async function listServerTags(signal?: AbortSignal): Promise<Tag[]> {
  try {
    return (await api().listServerTags(signal)).items;
  } catch (error) {
    rethrowClientError(error);
  }
}
