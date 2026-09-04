function safeIdPart(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9_-]/g, "-");
  return /[A-Za-z0-9]/.test(safe) ? safe : "chapter";
}

/** 普通正文章节 ID 只表达文章内身份；文章隔离由数据库复合主键负责。 */
export function chapterStorageId(_documentId: string, order: number): string {
  return "chapter-" + String(order);
}

/** 兼容旧调用：不再把文章 ID 编码进章节 ID。 */
export function scopedLongTextChapterId(
  _documentId: string,
  localChapterId: string,
): string {
  return safeIdPart(localChapterId).slice(0, 128);
}
