import { describe, expect, it } from "vitest";
import { EntityIdSchema } from "@ricetext/contracts";
import { chapterStorageId, scopedLongTextChapterId } from "./chapter-identity";

describe("chapter identity", () => {
  it("keeps chapter IDs independent from their document", () => {
    expect(chapterStorageId("demo-post", 0)).toBe("chapter-0");
    expect(chapterStorageId("article-a", 0)).toBe("chapter-0");
    expect(scopedLongTextChapterId("demo-post", "local-chapter-1")).toBe(
      "local-chapter-1",
    );
    expect(scopedLongTextChapterId("article-a", "local-chapter-1")).toBe(
      scopedLongTextChapterId("article-b", "local-chapter-1"),
    );
  });

  it("always emits a valid ID within the shared length limit", () => {
    const id = scopedLongTextChapterId("a".repeat(128), "章节".repeat(200));
    expect(id.length).toBeLessThanOrEqual(128);
    expect(EntityIdSchema.safeParse(id).success).toBe(true);
  });
});
