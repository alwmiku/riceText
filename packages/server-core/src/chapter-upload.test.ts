import { describe, expect, it } from "vitest";
import { decideChapterUploadWrite, normalizeChapterUploadManifest, serializeChapterUploadManifest } from "./chapter-upload";

describe("章节上传协议规则", () => {
  it("补齐默认卷名、移除清单外字段，并保留协议键顺序和文本", () => {
    const items = [
      { hash: "b", order: 1, title: " B ", id: "b", baseRevision: 7 },
      { hash: "a", order: 0, title: "A", id: "a", volumeTitle: "卷\n一" },
    ];
    expect(serializeChapterUploadManifest(items)).toBe('[{"id":"b","title":" B ","volumeTitle":"","order":1,"hash":"b"},{"id":"a","title":"A","volumeTitle":"卷\\n一","order":0,"hash":"a"}]');
    expect(normalizeChapterUploadManifest(items)[0]).toEqual({ id: "b", title: " B ", volumeTitle: "", order: 1, hash: "b" });
    expect(items[0]).not.toHaveProperty("volumeTitle");
  });
  it("不将版本为零的占位记录视为已发布正文", () => {
    expect(decideChapterUploadWrite({ revision: 0, content_hash: "same" }, { baseRevision: 0, hash: "same" })).toEqual({ status: "saved", revision: 1 });
    expect(decideChapterUploadWrite(undefined, { baseRevision: 0, hash: "new" })).toEqual({ status: "saved", revision: 1 });
  });
  it("应用哈希幂等规则前必须匹配暂存基线", () => {
    expect(decideChapterUploadWrite({ revision: 2, content_hash: "same" }, { baseRevision: 1, hash: "same" })).toEqual({ status: "conflict", currentRevision: 2 });
    expect(decideChapterUploadWrite({ revision: 2, content_hash: "same" }, { baseRevision: 2, hash: "same" })).toEqual({ status: "unchanged", revision: 2 });
    expect(decideChapterUploadWrite({ revision: 2, content_hash: "old" }, { baseRevision: 2, hash: "new" })).toEqual({ status: "saved", revision: 3 });
    expect(decideChapterUploadWrite(undefined, { baseRevision: 2, hash: "new" })).toEqual({ status: "conflict", currentRevision: 0 });
  });
});
