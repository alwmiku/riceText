import { describe, expect, it } from "vitest";
import {
  chapterVolumeKey,
  chapterVolumeTitle,
  expandActiveChapterVolume,
  groupChaptersByVolume,
  startsChapterVolume,
} from "./hierarchy";

const chapters = [
  { id: "a", volumeTitle: " 第一卷 " },
  { id: "b", volumeTitle: "第一卷" },
  { id: "c", volumeTitle: "第二卷" },
  { id: "d" },
] as const;

describe("文章卷章层级投影", () => {
  it("统一清理卷标题并识别卷起点", () => {
    expect(chapterVolumeTitle(chapters[0])).toBe("第一卷");
    expect(startsChapterVolume(chapters, 0)).toBe(true);
    expect(startsChapterVolume(chapters, 1)).toBe(false);
    expect(startsChapterVolume(chapters, 2)).toBe(true);
    expect(startsChapterVolume(chapters, 3)).toBe(false);
  });

  it("按连续卷段分组并保留文章内章节索引", () => {
    expect(chapterVolumeKey(chapters, 1)).toBe("volume:a");
    expect(groupChaptersByVolume(chapters)).toEqual([
      {
        key: "volume:a",
        title: "第一卷",
        items: [
          { chapter: chapters[0], index: 0 },
          { chapter: chapters[1], index: 1 },
        ],
      },
      { key: "volume:c", title: "第二卷", items: [{ chapter: chapters[2], index: 2 }] },
      { key: "", title: "", items: [{ chapter: chapters[3], index: 3 }] },
    ]);
  });

  it("只展开激活章节所在的卷", () => {
    const collapsed = new Set(["volume:a", "volume:c"]);
    expect(expandActiveChapterVolume(collapsed, chapters, 2)).toEqual(new Set(["volume:a"]));
    expect(expandActiveChapterVolume(collapsed, chapters, 3)).toBe(collapsed);
  });
});
