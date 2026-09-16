import { describe, expect, it } from "vitest";
import {
  CHAPTER_EDITOR_CAPABILITIES,
  chapterUnitCan,
  createChapterEditingUnit,
} from "./chapter-editing-unit";

describe("章节编辑单元", () => {
  it("收束文章、卷、章节和能力上下文", () => {
    const unit = createChapterEditingUnit({
      articleId: "article_1",
      articleTitle: "文章",
      baseRevision: 7,
      volumeTitle: " 第一卷 ",
      chapterId: "chapter_1",
      chapterTitle: "第一章",
      chapterOrder: 0,
      chapterRevision: 2,
      savedAt: "2026-09-16T00:00:00.000Z",
      source: "document",
      content: { type: "doc", content: [] },
      capabilities: [CHAPTER_EDITOR_CAPABILITIES.edit, "plugin.custom"],
    });

    expect(unit.volume).toEqual({ title: "第一卷" });
    expect(unit.chapter).toMatchObject({ id: "chapter_1", registered: true, revision: 2 });
    expect(chapterUnitCan(unit, CHAPTER_EDITOR_CAPABILITIES.edit)).toBe(true);
    expect(chapterUnitCan(unit, "plugin.custom")).toBe(true);
  });

  it("不为未注册章节伪造身份或卷", () => {
    const unit = createChapterEditingUnit({
      articleId: "article_1",
      articleTitle: "文章",
      baseRevision: 1,
      chapterTitle: "新章",
      chapterOrder: 1,
      chapterRevision: 0,
      savedAt: "2026-09-16T00:00:00.000Z",
      source: "placeholder",
      content: { type: "doc", content: [] },
    });
    expect(unit.volume).toBeNull();
    expect(unit.chapter.id).toBeNull();
    expect(unit.chapter.registered).toBe(false);
  });
});
