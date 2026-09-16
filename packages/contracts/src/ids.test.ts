import { describe, expect, it, vi } from "vitest";
import {
  ENTITY_ID_PREFIXES,
  UUID_V4_PATTERN,
  createEntityId,
  createTemporaryId,
  entityIdSchema,
  isCurrentEntityId,
} from "./ids";

describe("entity IDs", () => {
  it("creates a UUID v4 ID for every registered business prefix", () => {
    const prefixes = Object.values(ENTITY_ID_PREFIXES);
    const ids = prefixes.map((prefix) => createEntityId(prefix));
    for (const [index, prefix] of prefixes.entries()) {
      const id = ids[index]!;
      expect(id.startsWith(prefix + "_")).toBe(true);
      expect(UUID_V4_PATTERN.test(id.slice(prefix.length + 1))).toBe(true);
      expect(isCurrentEntityId(id, prefix)).toBe(true);
      expect(entityIdSchema(prefix).safeParse(id).success).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks local-only IDs as temporary", () => {
    expect(createTemporaryId("asset")).toMatch(/^tmp_asset_[0-9a-f-]{36}$/u);
    expect(createTemporaryId("roll")).toMatch(/^tmp_roll_[0-9a-f-]{36}$/u);
    expect(createTemporaryId("comment")).toMatch(/^tmp_comment_[0-9a-f-]{36}$/u);
  });

  it("uses getRandomValues when randomUUID is unavailable", () => {
    const original = globalThis.crypto;
    const getRandomValues = vi.fn(<T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint8Array) array.fill(0xab);
      return array;
    });
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { getRandomValues },
    });
    try {
      expect(createEntityId("article")).toBe("article_abababab-abab-4bab-abab-abababababab");
      expect(getRandomValues).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(globalThis, "crypto", { configurable: true, value: original });
    }
  });
});
