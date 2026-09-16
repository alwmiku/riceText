import { describe, expect, it } from "vitest";
import {
  createLongTextChapterId,
  isCurrentLongTextChapterId,
  migrateLongTextChapterIds,
} from "./long-text-ids";

describe("long text chapter identity", () => {
  it("创建时铸造一次与内容无关的身份", () => {
    const first = createLongTextChapterId();
    const second = createLongTextChapterId();
    expect(first).toMatch(/^chapter-[0-9a-f-]{36}$/u);
    expect(second).not.toBe(first);
  });

  it("认得出历史格式与新格式，不把它们当成缺身份", () => {
    expect(isCurrentLongTextChapterId("chapter-2f5c1d3a-9b7e-4c6f-8a1d-0e4b7c9d2f31")).toBe(true);
    // 历史内容哈希身份：改一个字就换 ID 的旧方案，但仍属已分配身份。
    expect(isCurrentLongTextChapterId("chapter-v1-" + "a".repeat(64))).toBe(true);
    expect(isCurrentLongTextChapterId("lt-2d25ad98-article-local-chapter-2")).toBe(false);
    expect(isCurrentLongTextChapterId("")).toBe(false);
  });

  it("只给缺身份的章节补铸，且正文改动不会换 ID", async () => {
    const migrated = await migrateLongTextChapterIds({
      type: "doc",
      content: [
        {
          type: "longTextBlock",
          attrs: { chapterId: "local-chapter-1", title: "第一章", text: "初稿" },
        },
      ],
    });
    const id = migrated.content?.[0]?.attrs?.chapterId;
    expect(isCurrentLongTextChapterId(id)).toBe(true);

    const edited = {
      ...migrated,
      content: (migrated.content ?? []).map((node) => ({
        ...node,
        attrs: { ...node.attrs, text: "修改后的正文" },
      })),
    };
    const restored = await migrateLongTextChapterIds(edited);
    expect(restored.content?.[0]?.attrs?.chapterId).toBe(id);
  });
});
