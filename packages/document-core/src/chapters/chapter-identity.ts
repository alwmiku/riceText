function safeIdPart(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9_-]/g, "-");
  return /[A-Za-z0-9]/.test(safe) ? safe : "chapter";
}

/**
 * 铸造一个新的章节身份：`chapter-<uuid>`。
 *
 * 身份在**创建时分配一次**，此后移动、改名、改正文都不变；ID 里不含位置，
 * 任何代码都不得从它反解章号。文章隔离由 `chapters` 表的复合主键
 * `(document_id, id)` 负责，因此不把文章 ID 编进章节 ID。
 *
 * `crypto.randomUUID` 在 Node 24、workerd 与浏览器安全上下文都可用；
 * 非安全上下文（例如局域网 http 页面）退回随机串，保证不抛错。
 */
export function createChapterId(): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : randomFallback();
  return "chapter-" + uuid;
}

/** 非安全上下文的兜底：形态与 UUID v4 一致，不承诺密码学随机性。 */
function randomFallback(): string {
  const hex = (length: number) =>
    Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return hex(8) + "-" + hex(4) + "-4" + hex(3) + "-" + hex(4) + "-" + hex(12);
}

/** 判断某个值是否是本仓库铸造的章节身份（`chapter-` 前缀）。 */
export function isChapterId(value: unknown): value is string {
  return typeof value === "string" && /^chapter-[A-Za-z0-9-]{1,120}$/u.test(value);
}

/**
 * 判断某个值能否当作章节身份使用。
 *
 * 身份只需要满足共享实体 ID 契约（字母数字加下划线/连字符）——历史数据里存在
 * `<docId>-chapter-<order>-<hex>`、`lt-…` 等并非 `chapter-` 前缀的合法身份，
 * 如果只认前缀，旧正文第一次保存就会把目录里的行变成孤儿。
 */
export function isUsableChapterId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(value)
  );
}

/**
 * @deprecated 按位置推导章节 ID。位置会变，ID 不能跟着变，新代码请用
 * {@link createChapterId}；这里只为过渡期兼容而保留。
 */
export function chapterStorageId(_documentId: string, order: number): string {
  return "chapter-" + String(order);
}

/** @deprecated 兼容旧调用：不再把文章 ID 编码进章节 ID。 */
export function scopedLongTextChapterId(_documentId: string, localChapterId: string): string {
  return safeIdPart(localChapterId).slice(0, 128);
}
