import { describe, expect, it } from "vitest";
import type { ChapterContent } from "./types";
import { chapterQueryKeys } from "./chapter-query-keys";
import { resolveChapterContent, resolveChapterSources } from "./chapter-source";
import type { ForumChapterItem, RichTextNode } from "./types";

const empty: RichTextNode = { type: "doc", content: [] };
const legacy: RichTextNode = { type: "doc", content: [
  { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "甲" }] },
  { type: "paragraph", content: [{ type: "text", text: "甲正文" }] },
  { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "乙" }] },
  { type: "paragraph", content: [{ type: "text", text: "乙正文" }] },
] };
const row = (overrides: Partial<ForumChapterItem> = {}): ForumChapterItem => ({
  id: "stable-a", documentId: "article", title: "甲", order: 0, revision: 0,
  savedAt: "2026-09-03T00:00:00.000Z", hidden: false, ...overrides,
});
const resolve = (directory: ForumChapterItem[], content = empty) => resolveChapterSources({ documentId: "article", content, directory, includeHidden: true });

describe("章节来源", () => {
  it("识别独立正文 v0，并使显式 false 优先于 revision", () => {
    expect(resolve([row({ hasContent: true })])[0]?.source).toBe("standalone");
    expect(resolve([row({ hasContent: false, revision: 8 })])[0]?.source).toBe("placeholder");
    expect(resolve([row({ revision: 2 })])[0]?.source).toBe("standalone");
    expect(resolve([row()])[0]?.source).toBe("placeholder");
  });

  it("按顺序绑定旧版标题，不使用未排序目录的索引", () => {
    const result = resolve([row({ id: "stable-b", order: 1 }), row()], legacy);
    expect(result.map((chapter) => chapter.id)).toEqual(["stable-a", "stable-b"]);
    expect(result[1]?.blocks[1]?.content?.[0]?.text).toBe("乙正文");
    expect(result[1]?.source).toBe("document");
  });

  it("重排后保留内嵌 ID，并拒绝仅位置相同的冒名章节", () => {
    const content: RichTextNode = { type: "doc", content: [
      { type: "longTextBlock", attrs: { chapterId: "stable-b", title: "乙", text: "乙正文" } },
      { type: "longTextBlock", attrs: { chapterId: "stable-a", title: "甲", text: "甲正文" } },
    ] };
    const result = resolve([row(), row({ id: "impostor", order: 1 })], content);
    expect(result[0]?.blocks[0]?.attrs?.text).toBe("甲正文");
    expect(result[1]?.source).toBe("placeholder");
  });

  it("仅在全部可见旧版位置均有对应项时映射压缩后的阅读投影", () => {
    const directory = [row({ id: "visible-a", order: 2 }), row({ id: "visible-b", order: 5 })];
    const result = resolveChapterSources({ documentId: "article", content: legacy, directory, documentIsReaderProjection: true });
    expect(result[1]?.id).toBe("visible-b");
    expect(result[1]?.blocks[1]?.content?.[0]?.text).toBe("乙正文");
    expect(resolveChapterSources({ documentId: "article", content: legacy, directory: [directory[1]!], documentIsReaderProjection: true })[0]?.source).toBe("placeholder");
  });

  it("完成全文映射后过滤隐藏章节，并保留作者预览能力", () => {
    const directory = [row({ hidden: true }), row({ id: "stable-b", order: 1 })];
    const visible = resolveChapterSources({ documentId: "article", content: legacy, directory });
    expect(visible.map((chapter) => chapter.id)).toEqual(["stable-b"]);
    expect(visible[0]?.blocks[1]?.content?.[0]?.text).toBe("乙正文");
    expect(resolve(directory, legacy)).toHaveLength(2);
  });

  it("按文档隔离相同章节 ID，且不修改输入", () => {
    const directory = [row({ documentId: "other", hasContent: true }), row()];
    const before = JSON.stringify({ directory, legacy });
    expect(resolve(directory, legacy)[0]?.documentId).toBe("article");
    expect(resolve(directory, legacy)[0]?.source).toBe("document");
    expect(JSON.stringify({ directory, legacy })).toBe(before);
    expect(chapterQueryKeys.content("article", "same")).not.toEqual(chapterQueryKeys.content("other", "same"));
    expect(chapterQueryKeys.content("article", "same").slice(0, 3)).toEqual(chapterQueryKeys.contents("article"));
    expect(chapterQueryKeys.directory("article").slice(0, 2)).toEqual(chapterQueryKeys.directories());
  });

  it("区分占位章节与加载失败，且不按位置回退", () => {
    const chapter = resolve([row({ hasContent: true })], legacy)[0]!;
    expect(resolveChapterContent(chapter)).toEqual({ source: "loading" });
    expect(resolveChapterContent(chapter, { isError: true })).toEqual({ source: "error" });
    expect(resolveChapterContent(resolve([row()])[0])).toEqual({ source: "placeholder" });
    const response: ChapterContent = { ...row(), content: { type: "doc", content: [] } };
    expect(resolveChapterContent(chapter, { data: response }).source).toBe("standalone");
    expect(resolveChapterContent(chapter, { data: response, isError: true })).toEqual({ source: "error" });
    expect(resolveChapterContent(chapter, { data: { ...response, documentId: "other" } })).toEqual({ source: "error" });
    expect(resolveChapterContent(chapter, { data: { ...response, id: "other" } })).toEqual({ source: "error" });
  });

  it("Compose 优先使用本地内嵌编辑，Reader 优先使用独立正文", () => {
    const input = { documentId: "article", content: legacy, directory: [row({ hasContent: true })] };
    expect(resolveChapterSources(input)[0]?.source).toBe("standalone");
    const local = resolveChapterSources({ ...input, preferDocumentContent: true, includeUnlistedDocumentChapters: true });
    expect(local[0]?.source).toBe("document");
    expect(local).toHaveLength(2);
  });

  it("将空段落壳视为空内容，同时保留非文本富节点", () => {
    expect(resolve([], { type: "doc", content: [{ type: "paragraph" }] })).toEqual([]);
    const result = resolve([], { type: "doc", content: [{ type: "attachmentRef", attrs: { attachmentId: "asset" } }] });
    expect(result[0]?.source).toBe("document");
  });
});
