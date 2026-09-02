import type { DocumentEnvelope } from "../types";

const documentCacheKey = (id: string) => `ricetext:document:${id}`;

/** 没有服务器文章和本地缓存时返回空壳，绝不把演示种子冒充真实内容。 */
export function missingDocument(id: string): DocumentEnvelope {
  return {
    id,
    title: "未命名文章",
    schemaVersion: 1,
    revision: 0,
    savedAt: new Date(0).toISOString(),
    content: { type: "doc", content: [] },
    storage: "missing",
  };
}

/** Read a cached document, falling back to an explicit blank missing state. */
export function readCachedDocument(id: string): DocumentEnvelope {
  const cached = localStorage.getItem(documentCacheKey(id));
  return cached ? (JSON.parse(cached) as DocumentEnvelope) : missingDocument(id);
}

export function writeCachedDocument(id: string, document: DocumentEnvelope): void {
  localStorage.setItem(documentCacheKey(id), JSON.stringify(document));
}
