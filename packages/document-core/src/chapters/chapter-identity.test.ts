import { describe, expect, it } from "vitest";
import { EntityIdSchema } from "@ricetext/contracts";
import { chapterStorageId, scopedLongTextChapterId } from "./chapter-identity";

describe("chapter identity", () => {
  it("keeps legacy demo IDs and existing ordinary chapter IDs stable", () => {
    expect(chapterStorageId("demo-post", 0)).toBe("chapter-0");
    expect(scopedLongTextChapterId("demo-post", "local-chapter-1")).toBe(
      "local-chapter-1",
    );
  });

  it("scopes the same long-text chapter to different documents", () => {
    const first = scopedLongTextChapterId("article-a", "local-chapter-1");
    const second = scopedLongTextChapterId("article-b", "local-chapter-1");
    expect(first).not.toBe(second);
    expect(scopedLongTextChapterId("article-a", first)).toBe(first);
  });

  it("always emits a valid ID within the shared length limit", () => {
    const id = scopedLongTextChapterId("a".repeat(128), "章节".repeat(200));
    expect(id.length).toBeLessThanOrEqual(128);
    expect(EntityIdSchema.safeParse(id).success).toBe(true);
  });
});
