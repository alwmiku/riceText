import { describe, expect, it } from "vitest";
import {
  CUSTOM_EMOJI_ENTRIES,
  DEFAULT_EMOJI_QUERY_LIMIT,
  EMOJI_CATALOG,
  EMOJI_GROUPS,
  EMOJI_ID_PATTERN,
  TEXT_EMOJI_ENTRIES,
  emojiAssetMimeType,
  emojiThumbnailFileName,
  emojiThumbnailMimeType,
  emojiThumbnailPath,
  emojiAssetFileName,
  emojiAssetPath,
  emojiEntriesByGroup,
  findEmojiEntry,
  hasEmojiAsset,
  searchEmojiEntries,
} from "./emoji-catalog.js";

/** 目录是 schema 与渲染共享的常量，任何破坏性改动都应在这里先失败。 */
describe("表情目录", () => {
  it("条目结构合法：唯一 id、合法分组、非空文本且不含控制字符", () => {
    const ids = new Set<string>();
    for (const entry of EMOJI_CATALOG) {
      expect(entry.id).toMatch(EMOJI_ID_PATTERN);
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
      expect(EMOJI_GROUPS.map((group) => group.id)).toContain(entry.groupId);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.text.length).toBeGreaterThan(0);
      // 正文按 text 节点持久化，控制字符会被净化器拒绝。
      const hasControlCharacter = Array.from(entry.text).some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code <= 0x1f || code === 0x7f;
      });
      expect(hasControlCharacter).toBe(false);
      expect(entry.text.length).toBeLessThanOrEqual(16);
    }
    expect(EMOJI_CATALOG.length).toBeGreaterThanOrEqual(120);
  });

  it("快捷码不跨条目冲突，避免 hh 类输入命中不确定的表情", () => {
    const owners = new Map<string, string>();
    for (const entry of EMOJI_CATALOG) {
      for (const code of entry.shortcodes ?? []) {
        const owner = owners.get(code);
        expect(
          owner === undefined,
          `快捷码 ${code} 同时被 ${owner ?? ""} 与 ${entry.id} 声明`,
        ).toBe(true);
        owners.set(code, entry.id);
      }
    }
    expect(owners.get("hh")).toBe("shy-sticker");
  });

  it("缓存派生路径：只有自定义表情有图片，未知 id 一律返回空", () => {
    expect(hasEmojiAsset("hug")).toBe(true);
    expect(hasEmojiAsset("smile")).toBe(false);
    expect(hasEmojiAsset("no-such-emoji")).toBe(false);
    expect(emojiAssetPath("hug")).toBe("/api/emoji/hug/image");
    expect(emojiAssetPath("smile")).toBeNull();
    expect(emojiAssetFileName("hug")).toBe("抱抱.gif");
    expect(emojiAssetMimeType("hug")).toBe("image/gif");
    expect(emojiAssetMimeType("smile")).toBeNull();
    // 动图另有构建期生成的首帧缩略图，面板与候选浮层用它避免解码十几张动图。
    expect(emojiThumbnailFileName("hug")).toBe("hug.png");
    expect(emojiThumbnailPath("hug")).toBe("/api/emoji/hug/image?frame=first");
    expect(emojiThumbnailMimeType("hug")).toBe("image/png");
    expect(emojiThumbnailPath("smile")).toBeNull();
    expect(emojiThumbnailPath("no-such-emoji")).toBeNull();
    expect(emojiAssetFileName("nope")).toBeNull();
    expect(CUSTOM_EMOJI_ENTRIES.every((entry) => emojiAssetPath(entry.id) !== null)).toBe(true);
    expect(TEXT_EMOJI_ENTRIES.every((entry) => emojiAssetPath(entry.id) === null)).toBe(true);
  });

  it("按分组取条目，未知分组返回空数组", () => {
    expect(emojiEntriesByGroup("kaomoji").length).toBeGreaterThanOrEqual(30);
    expect(emojiEntriesByGroup("custom").length).toBe(CUSTOM_EMOJI_ENTRIES.length);
    expect(emojiEntriesByGroup("unknown")).toEqual([]);
  });

  it("搜索：快捷码与名称优先命中，空查询返回默认序，无匹配返回空", () => {
    const hh = searchEmojiEntries("hh");
    // hh 同时是「害羞」的快捷码与站点表情入口。
    expect(hh[0]?.id).toBe("shy-sticker");
    expect(searchEmojiEntries("hug")[0]?.id).toBe("hug");
    expect(searchEmojiEntries("抱抱")[0]?.id).toBe("hug");
    expect(searchEmojiEntries("微笑")[0]?.id).toBe("smile");
    expect(searchEmojiEntries("wx")[0]?.id).toBe("smile");
    expect(searchEmojiEntries("kao3")[0]?.id).toBe("kao-cry");
    expect(searchEmojiEntries("")).toEqual(EMOJI_CATALOG.slice(0, 100));
    expect(searchEmojiEntries("hh", DEFAULT_EMOJI_QUERY_LIMIT).length).toBeLessThanOrEqual(
      DEFAULT_EMOJI_QUERY_LIMIT,
    );
    expect(searchEmojiEntries("绝不存在的情感关键词")).toEqual([]);
  });

  it("findEmojiEntry 命中目录或返回 undefined", () => {
    expect(findEmojiEntry("water")?.name).toBe("浇水");
    expect(findEmojiEntry("missing")).toBeUndefined();
  });
});
