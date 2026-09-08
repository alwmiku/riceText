import type { NovelExcerptVariant } from "./types.js";

/** 支持四种平台模板；旧模板、未知值和缺省值统一回退到番茄。 */
export function normalizeNovelExcerptVariant(value: unknown): NovelExcerptVariant {
  return value === "qidian" || value === "sfacg" || value === "ciweimao" ? value : "fanqie";
}
