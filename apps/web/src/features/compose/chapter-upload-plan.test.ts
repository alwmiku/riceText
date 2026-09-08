import { describe, expect, it, vi } from "vitest";
import type { RichTextNode } from "../../lib/types";
import {
  applyChapterUploadSync,
  prepareChapterUploadPlan,
  toUploadDiff,
} from "./chapter-upload-plan";

const document: RichTextNode = {
  type: "doc",
  content: [
    {
      type: "longTextBlock",
      attrs: {
        chapterId: "local",
        title: "第一章",
        volumeTitle: "第一卷",
        text: "正文",
      },
    },
    {
      type: "longTextBlock",
      attrs: { chapterId: "existing", title: "第二章", text: "续文" },
    },
  ],
};

describe("章节上传计划", () => {
  it("远端顺序重叠时保持本地标识不变，并将卷元数据计入哈希", async () => {
    const hash = vi.fn().mockResolvedValue("a".repeat(64));
    const directory = [
      { id: "remote", title: "旧占位", order: 0, revision: 3 },
      { id: "existing", order: 1, revision: 4 },
    ];
    const prepared = await prepareChapterUploadPlan(
      "article",
      document,
      directory,
      2,
      hash,
    );
    const plan = applyChapterUploadSync(prepared.checkpoint, directory, {
      toUpdate: ["local", "existing"],
      existing: ["existing", "remote"],
    });
    expect(
      plan.chapters.map(({ id, action, status, baseRevision }) => [
        id,
        action,
        status,
        baseRevision,
      ]),
    ).toEqual([
      ["local", "add", "pending", 0],
      ["existing", "modify", "pending", 4],
      ["remote", "remote_only", "awaiting_replacement", 3],
    ]);
    expect(JSON.parse(hash.mock.calls[0]![0])).toMatchObject({
      title: "第一章",
      volumeTitle: "第一卷",
      order: 0,
    });
    expect(
      JSON.stringify(prepared.contentByChapter.get("local")!.content),
    ).not.toContain("longTextBlock");
    expect(toUploadDiff(plan, { current: 1, total: 2 })).toMatchObject({
      total: 2,
      added: 1,
      modified: 1,
      remoteOnly: 1,
      gaps: 2,
      rows: [{ volumeTitle: "第一卷" }, {}, {}],
    });
    expect(prepared.checkpoint.chapters[0]!.status).toBe("unchanged");
    expect(plan).not.toHaveProperty("version");
  });

  it("计算或发送清单前拒绝重复的本地标识", async () => {
    const hash = vi.fn();
    await expect(
      prepareChapterUploadPlan(
        "article",
        {
          type: "doc",
          content: [document.content![0]!, document.content![0]!],
        },
        [],
        0,
        hash,
      ),
    ).rejects.toThrow("本地章节标识为空或重复");
    expect(hash).not.toHaveBeenCalled();
  });

  it("单独统计未变化行与上传行，同时保留完整清单", async () => {
    const prepared = await prepareChapterUploadPlan(
      "article",
      document,
      [],
      0,
      async () => "a".repeat(64),
    );
    const plan = applyChapterUploadSync(prepared.checkpoint, [], {
      toUpdate: ["local"],
      existing: ["existing"],
    });
    expect(toUploadDiff(plan, { current: null, total: null })).toMatchObject({
      total: 2,
      toUpdate: 2,
      added: 1,
      pending: 1,
      uploaded: 0,
    });
    expect(plan.chapters[1]).toMatchObject({
      action: "unchanged",
      status: "unchanged",
    });
  });
});
