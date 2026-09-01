import { defaultDocument } from "../seed";
import type { DocumentEnvelope } from "../types";

const documentCacheKey = (id: string) => `ricetext:document:${id}`;

/** Read a cached document, falling back to the built-in seed document. */
export function readCachedDocument(id: string): DocumentEnvelope {
  const cached = localStorage.getItem(documentCacheKey(id));
  return cached ? (JSON.parse(cached) as DocumentEnvelope) : defaultDocument;
}

export function writeCachedDocument(id: string, document: DocumentEnvelope): void {
  localStorage.setItem(documentCacheKey(id), JSON.stringify(document));
}
