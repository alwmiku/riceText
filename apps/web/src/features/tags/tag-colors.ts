import type { CSSProperties } from "react";
import type { DocumentTag } from "@ricetext/contracts";

/**
 * 标签胶囊的配色。
 *
 * 服务器标签是彩色胶囊，色相由 slug 决定：同一个标签在任何页面都是同一种颜色，
 * 因此颜色不需要存进数据库，改 label 也不会变色；色相铺满整个色环，多个标签并排时
 * 不会撞成同一种颜色。作者自己加的标签不带颜色（中性灰），一眼可分。
 */

/** 所有标签胶囊共用的几何样式。 */
export const TAG_CHIP_BASE =
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold";

/** 作者自建标签的中性配色：没有颜色。 */
export const AUTHOR_TAG_CLASS = "bg-[#f1f3f5] text-[#5b666f]";

/** 把 slug 散列到 0-359 的色相；同一输入永远得到同一色相。 */
function tagHue(slug: string): number {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 100_003;
  return hash % 360;
}

/** 服务器标签的内联配色；作者标签返回 undefined，改用中性 class。 */
export function tagChipStyle(
  tag: Pick<DocumentTag, "slug" | "source">,
): CSSProperties | undefined {
  if (tag.source !== "server") return undefined;
  const hue = tagHue(tag.slug);
  // 同色相的浅底 + 深字：对比度稳定在 9:1 左右，且不会出现刺眼的饱和色块。
  return {
    backgroundColor: `hsl(${hue} 68% 92%)`,
    color: `hsl(${hue} 55% 30%)`,
  };
}

/** 标签胶囊的来源样式类：只有作者标签需要（服务器标签走内联配色）。 */
export function tagChipClassName(tag: Pick<DocumentTag, "slug" | "source">): string {
  return tag.source === "server" ? "" : AUTHOR_TAG_CLASS;
}
