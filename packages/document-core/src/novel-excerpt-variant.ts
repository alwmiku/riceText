import type { NovelExcerptVariant } from "./types.js";

/** 旧模板、未知值和缺省值统一回退到番茄，仅保留两种平台模板。 */
export function normalizeNovelExcerptVariant(value: unknown): NovelExcerptVariant {
  return value === "qidian" ? "qidian" : "fanqie";
}
