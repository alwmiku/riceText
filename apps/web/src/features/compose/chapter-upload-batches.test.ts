import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api";
import {
  backoffDelay,
  bisectBatch,
  isBlockingBatchError,
  isRetryableBatchError,
  isTooLargeBatchError,
  MAX_BATCH_BYTES,
  MAX_CHAPTERS_PER_BATCH,
  MAX_REORDER_PER_BATCH,
  splitByCount,
  splitUploadBatches,
  utf8ByteLength,
  type UploadBatchChapterItem,
} from "./chapter-upload-batches";

function item(id: string, size: number): UploadBatchChapterItem {
  return {
    id,
    title: "章节 " + id,
    order: Number(id.replace("c", "")),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "x".repeat(size) }],
        },
      ],
    },
    hash: "hash-" + id,
    baseRevision: 0,
  };
}

describe("splitUploadBatches", () => {
  it("按最多 20 章切批：3000 章产生 150 批", () => {
    const chapters = Array.from({ length: 3000 }, (_, index) =>
      item("c" + index, 20),
    );
    const batches = splitUploadBatches(chapters);
    expect(batches).toHaveLength(150);
    expect(batches.every((batch) => batch.length <= 20)).toBe(true);
    expect(batches.flat()).toHaveLength(3000);
    expect(batches[0]?.[0]?.id).toBe("c0");
    expect(batches[149]?.at(-1)?.id).toBe("c2999");
  });

  it("按序列化字节上限动态切批，超过 4 MiB 时拆小", () => {
    // 每章约 1.5 MiB 正文：两章约 3 MiB 可容，三章约 4.5 MiB 超限后拆批。
    const chapters = [
      item("a", 1.5 * 1024 * 1024),
      item("b", 1.5 * 1024 * 1024),
      item("c", 1.5 * 1024 * 1024),
      item("d", 1.5 * 1024 * 1024),
    ];
    const batches = splitUploadBatches(chapters);
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(
        utf8ByteLength(JSON.stringify({ chapters: batch })),
      ).toBeLessThanOrEqual(MAX_BATCH_BYTES);
      expect(batch.length).toBeLessThanOrEqual(MAX_CHAPTERS_PER_BATCH);
    }
    expect(batches.flat()).toHaveLength(4);
  });

  it("单章超过 4 MiB 时独占一批", () => {
    const huge = item("huge", 5 * 1024 * 1024);
    const batches = splitUploadBatches([huge]);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([huge]);
  });
});

describe("splitByCount / bisectBatch", () => {
  it("换序暂存按 40 项切批", () => {
    const items = Array.from({ length: 95 }, (_, index) => ({
      id: "c" + index,
    }));
    const batches = splitByCount(items, MAX_REORDER_PER_BATCH);
    expect(batches).toHaveLength(3);
    expect(batches.map((batch) => batch.length)).toEqual([40, 40, 15]);
  });

  it("二分批次保序，单章不可再分", () => {
    const input = ["a", "b", "c"].map((id) => ({ id }));
    expect(bisectBatch(input)).toEqual([
      [{ id: "a" }, { id: "b" }],
      [{ id: "c" }],
    ]);
    expect(bisectBatch([{ id: "a" }])).toBeNull();
  });
});

describe("错误分类与退避", () => {
  it("429/5xx/网络中断可重试，409/422/413 不自动重试", () => {
    expect(isRetryableBatchError(new ApiError("限流", 429))).toBe(true);
    expect(isRetryableBatchError(new ApiError("D1 overloaded", 503))).toBe(true);
    expect(isRetryableBatchError(new ApiError("upstream", 502))).toBe(true);
    expect(isRetryableBatchError(new Error("network down"))).toBe(true);
    expect(isRetryableBatchError(new ApiError("conflict", 409))).toBe(false);
    expect(isRetryableBatchError(new ApiError("invalid", 422))).toBe(false);
    expect(isRetryableBatchError(new ApiError("too large", 413))).toBe(false);

    expect(isBlockingBatchError(new ApiError("conflict", 409))).toBe(true);
    expect(isBlockingBatchError(new ApiError("invalid", 422))).toBe(true);
    expect(isBlockingBatchError(new Error("network"))).toBe(false);
    expect(isTooLargeBatchError(new ApiError("too large", 413))).toBe(true);
    expect(isTooLargeBatchError(new ApiError("conflict", 409))).toBe(false);
  });

  it("退避时间按指数递增", () => {
    expect(backoffDelay(0)).toBe(250);
    expect(backoffDelay(1)).toBe(500);
    expect(backoffDelay(2)).toBe(1000);
  });
});
