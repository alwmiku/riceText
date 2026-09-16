import { describe, expect, it } from "vitest";
import { EntityIdSchema } from "@ricetext/contracts";
import {
  chapterStorageId,
  createChapterId,
  isChapterId,
  scopedLongTextChapterId,
} from "./chapter-identity";

describe("chapter identity", () => {
  it("铸造位置无关且每次都不同的章节身份", () => {
    const first = createChapterId();
    const second = createChapterId();
    expect(first).toMatch(/^chapter-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    expect(second).not.toBe(first);
  });

  it("身份满足共享实体 ID 契约", () => {
    for (let index = 0; index < 20; index += 1) {
      const id = createChapterId();
      expect(id.length).toBeLessThanOrEqual(128);
      expect(EntityIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it("isChapterId 只接受 chapter- 前缀的非空标识", () => {
    expect(isChapterId(createChapterId())).toBe(true);
    expect(isChapterId("chapter-v1-" + "a".repeat(64))).toBe(true);
    expect(isChapterId("chapter-0")).toBe(true);
    expect(isChapterId("local-one")).toBe(false);
    expect(isChapterId("")).toBe(false);
    expect(isChapterId(undefined)).toBe(false);
  });

  it("保留旧推导函数仅为兼容读取", () => {
    // 这两个函数不再有生产调用点；断言存在只为防止误删导致的隐性行为变化。
    expect(chapterStorageId("demo-post", 0)).toBe("chapter-0");
    expect(scopedLongTextChapterId("demo-post", "local-chapter-1")).toBe("local-chapter-1");
  });
});
