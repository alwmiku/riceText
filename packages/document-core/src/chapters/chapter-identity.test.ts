import { describe, expect, it } from "vitest";
import { EntityIdSchema } from "@ricetext/contracts";
import { createChapterId, isChapterId, isUsableChapterId } from "./chapter-identity";

describe("chapter identity", () => {
  it("铸造位置无关且每次都不同的章节身份", () => {
    const first = createChapterId();
    const second = createChapterId();
    expect(first).toMatch(
      /^chapter_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(second).not.toBe(first);
  });

  it("身份满足共享实体 ID 契约", () => {
    for (let index = 0; index < 20; index += 1) {
      const id = createChapterId();
      expect(id.length).toBeLessThanOrEqual(128);
      expect(EntityIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it("isChapterId 接受当前和历史章节前缀", () => {
    expect(isChapterId(createChapterId())).toBe(true);
    expect(isChapterId("chapter-v1-" + "a".repeat(64))).toBe(true);
    expect(isChapterId("chapter-0")).toBe(true);
    expect(isChapterId("local-one")).toBe(false);
    expect(isChapterId("")).toBe(false);
    expect(isChapterId(undefined)).toBe(false);
  });

  it("非标准前缀的历史章节仍可作为不透明身份读取", () => {
    expect(isUsableChapterId("article-0-chapter-1-placeholder")).toBe(true);
    expect(isUsableChapterId("lt-2d25ad98-article-local-chapter-2")).toBe(true);
  });
});
