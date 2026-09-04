import { describe, expect, it } from "vitest";
import {
  createLongTextChapterId,
  migrateLongTextChapterIds,
} from "./long-text-ids";

describe("long text chapter identity", () => {
  it("normalizes title Unicode and line endings before SHA-256", async () => {
    const decomposed = await createLongTextChapterId(" e\u0301 ", "第一行\r\n第二行");
    const composed = await createLongTextChapterId("é", "第一行\n第二行");
    expect(decomposed).toBe(composed);
    expect(composed).toMatch(/^chapter-v1-[0-9a-f]{64}$/);
  });

  it("migrates a legacy ID once and keeps it after later content edits", async () => {
    const migrated = await migrateLongTextChapterIds({
      type: "doc",
      content: [
        {
          type: "longTextBlock",
          attrs: {
            chapterId: "local-chapter-1",
            title: "第一章",
            text: "初稿",
          },
        },
      ],
    });
    const id = migrated.content?.[0]?.attrs?.chapterId;
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
