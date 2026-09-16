import { createEntityId, isCurrentEntityId } from "@ricetext/contracts";

/**
 * 章节身份只在创建时铸造一次；位置、标题和正文变化都不会改变 ID。
 */
export function createChapterId(): string {
  return createEntityId("chapter");
}

/** 接受当前 `chapter_<uuid>` 以及已经持久化的历史 `chapter-*` 身份。 */
export function isChapterId(value: unknown): value is string {
  return (
    isCurrentEntityId(value, "chapter") ||
    (typeof value === "string" && /^chapter-[A-Za-z0-9-]{1,120}$/u.test(value))
  );
}

/**
 * 判断一个值能否继续引用既有章节。历史数据还包含文章作用域 ID 和旧长文本 ID，
 * 因此读取兼容只检查共享字符契约，不要求它们伪装成当前格式。
 */
export function isUsableChapterId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(value)
  );
}
