import { describe, expect, it } from "vitest";
import {
  TAG_LIMIT,
  normalizeTagLabel,
  resolveDocumentTags,
  tagSlug,
  type ServerTagLike,
} from "./tags.js";

const dictionary: ServerTagLike[] = [
  { id: "tag-serial", slug: tagSlug("连载中"), label: "连载中" },
  { id: "tag-fantasy", slug: tagSlug("奇幻"), label: "奇幻" },
  { id: "tag-retired", slug: tagSlug("停更"), label: "停更", hidden: true },
];

describe("标签文本规范化", () => {
  it("折成半角并去掉开头的 # 标记", () => {
    expect(normalizeTagLabel("＃慢热")).toBe("慢热");
    expect(normalizeTagLabel("## 慢热")).toBe("慢热");
    expect(normalizeTagLabel("  #  连载中  ")).toBe("连载中");
  });

  it("保留标签内部的 #，只把开头当成标记", () => {
    expect(normalizeTagLabel("C#")).toBe("C#");
    expect(normalizeTagLabel("#C#")).toBe("C#");
  });

  it("折叠内部空白并去掉不可见字符", () => {
    expect(normalizeTagLabel("慢​热  日 记")).toBe("慢热 日 记");
    expect(normalizeTagLabel("全角　空格")).toBe("全角 空格");
  });

  it("拒绝空文本、纯标点与超长文本", () => {
    expect(normalizeTagLabel("   ")).toBeNull();
    expect(normalizeTagLabel("###")).toBeNull();
    expect(normalizeTagLabel("——")).toBeNull();
    expect(normalizeTagLabel("字".repeat(25))).toBeNull();
    expect(normalizeTagLabel("字".repeat(24))).toBe("字".repeat(24));
  });
});

describe("标签对比键", () => {
  it("大小写与空白等价，保留中文", () => {
    expect(tagSlug("Slow Burn")).toBe("slow-burn");
    expect(tagSlug("slow  burn")).toBe("slow-burn");
    expect(tagSlug("连载中")).toBe("连载中");
  });

  it("标点折叠成连字符且不留首尾连字符", () => {
    expect(tagSlug("雾港·来信")).toBe("雾港-来信");
    expect(tagSlug("...")).toBe("");
  });
});

describe("文章标签解析", () => {
  it("命中未隐藏的站点标签时归为服务器标签", () => {
    const result = resolveDocumentTags(["连载中", "#奇幻"], dictionary);
    expect(result).toEqual({
      ok: true,
      tags: [
        { slug: tagSlug("连载中"), label: "连载中", source: "server", tagId: "tag-serial" },
        { slug: tagSlug("奇幻"), label: "奇幻", source: "server", tagId: "tag-fantasy" },
      ],
    });
  });

  it("隐藏的站点标签不参与匹配，同文本落成作者标签", () => {
    const result = resolveDocumentTags(["停更"], dictionary);
    expect(result).toEqual({
      ok: true,
      tags: [{ slug: tagSlug("停更"), label: "停更", source: "author", tagId: null }],
    });
  });

  it("按 slug 去重并保留第一次出现的顺序", () => {
    const result = resolveDocumentTags(["慢热", "#慢热", " 慢热 ", "日更", "日更"], dictionary);
    expect(result.ok && result.tags.map((tag) => tag.label)).toEqual(["慢热", "日更"]);
    // 空白折叠成连字符，「慢 热」与「慢热」是两个不同的标签。
    expect(tagSlug("慢 热")).toBe("慢-热");
  });

  it("文本非法与超过上限都返回稳定错误码", () => {
    expect(resolveDocumentTags(["###"], dictionary)).toMatchObject({
      ok: false,
      code: "TAG_LABEL_INVALID",
    });
    const tooMany = Array.from({ length: TAG_LIMIT + 1 }, (_, index) => "标签" + index);
    expect(resolveDocumentTags(tooMany, dictionary)).toMatchObject({
      ok: false,
      code: "TAG_LIMIT_EXCEEDED",
    });
    // 去重后不超限就不算超限。
    expect(resolveDocumentTags([...tooMany.slice(0, TAG_LIMIT), "标签0"], dictionary).ok).toBe(true);
  });
});
