const MAX_ENTITY_ID_LENGTH = 128;

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function safeIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-") || "chapter";
}

/** 普通正文按文章和位置生成的全局章节主键；demo-post 保留历史 ID。 */
export function chapterStorageId(documentId: string, order: number): string {
  if (documentId === "demo-post") return "chapter-" + String(order);
  const suffix = "-chapter-" + String(order) + "-" + stableHash(documentId);
  return documentId.slice(0, Math.max(1, MAX_ENTITY_ID_LENGTH - suffix.length)) + suffix;
}

/** 长文本章节保留本地语义身份，同时加入文章指纹以隔离全局主键。 */
export function scopedLongTextChapterId(
  documentId: string,
  localChapterId: string,
): string {
  if (documentId === "demo-post") return safeIdPart(localChapterId);

  const documentHash = stableHash(documentId);
  const prefix = `lt-${documentHash}-`;
  const safeLocalId = safeIdPart(localChapterId);
  if (safeLocalId.startsWith(prefix)) return safeLocalId;

  const suffix = `-${stableHash(documentId + "\0" + localChapterId)}`;
  const body = `${prefix}${safeIdPart(documentId)}-${safeLocalId}`;
  return body.slice(0, MAX_ENTITY_ID_LENGTH - suffix.length) + suffix;
}
