import { describe, expect, it } from "vitest";
import { AUTHOR_TAG_CLASS, TAG_CHIP_BASE, tagChipClassName, tagChipStyle } from "./tag-colors";

describe("标签胶囊配色", () => {
  it("同一个站点标签永远取同一种颜色，且铺满色环不撞色", () => {
    const first = tagChipStyle({ slug: "shui-tie", source: "server" });
    expect(tagChipStyle({ slug: "shui-tie", source: "server" })).toEqual(first);
    expect(first?.backgroundColor).toMatch(/^hsl\(\d+ 68% 92%\)$/u);
    expect(first?.color).toMatch(/^hsl\(\d+ 55% 30%\)$/u);
    expect(TAG_CHIP_BASE).toContain("rounded-full");

    const hues = new Set(
      ["shui-tie", "ba-wu", "tui-shu", "zhu-gong", "zhu-shou", "lian-zai"].map((slug) =>
        String(tagChipStyle({ slug, source: "server" })?.backgroundColor),
      ),
    );
    expect(hues.size).toBe(6);
  });

  it("作者标签没有颜色，恒为中性样式", () => {
    expect(tagChipStyle({ slug: "慢热", source: "author" })).toBeUndefined();
    expect(tagChipClassName({ slug: "慢热", source: "author" })).toBe(AUTHOR_TAG_CLASS);
    expect(tagChipClassName({ slug: "连载中", source: "server" })).toBe("");
  });
});
