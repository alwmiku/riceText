import { describe, expect, it } from "vitest";
import {
  decodeUploadCheckpoint,
  encodeUploadCheckpoint,
  restoreUploadPlan,
  type UploadCheckpointV6,
} from "./chapter-upload-checkpoint";

function fixture(): UploadCheckpointV6 {
  return {
    version: 6,
    novelId: "article",
    gaps: 1,
    chapters: [
      {
        id: "one",
        title: "第一章",
        volumeTitle: "第一卷",
        order: 0,
        hash: "a".repeat(64),
        baseRevision: 0,
        action: "add",
        status: "pending",
        attempts: 0,
      },
    ],
  };
}

describe("上传检查点边界", () => {
  it("往返编解码仅保留元数据并复制章节状态", () => {
    const stored = fixture();
    const decoded = decodeUploadCheckpoint(stored, "article");
    expect(decoded.kind).toBe("valid");
    if (decoded.kind !== "valid") throw new Error("预期检查点有效");
    const runtime = {
      ...decoded.plan,
      content: { text: "正文草稿" },
      batchCurrent: 3,
    };
    const encoded = encodeUploadCheckpoint(runtime);
    decoded.plan.chapters[0]!.status = "uploaded";
    expect(encoded).toEqual(stored);
    expect(encoded).not.toHaveProperty("content");
    expect(encoded).not.toHaveProperty("batchCurrent");
    expect(decoded.migrated).toBe(false);
  });

  it("显式迁移 v5 的全部中文状态与操作", () => {
    const entries = [
      ["新增", "待上传", "add", "pending"],
      ["修改", "上传中", "modify", "pending"],
      ["新增", "已上传", "add", "uploaded"],
      ["未变化", "未变化", "unchanged", "unchanged"],
      ["修改", "失败", "modify", "pending"],
      ["服务器额外", "待整套替换", "remote_only", "awaiting_replacement"],
    ];
    const legacy = {
      ...fixture(),
      version: 5,
      chapters: entries.map(([action, status], order) => ({
        ...fixture().chapters[0],
        id: "chapter-" + order,
        order,
        hash: action === "服务器额外" ? "" : "a".repeat(64),
        action,
        status,
      })),
    };
    const result = decodeUploadCheckpoint(legacy, "article");
    expect(result.kind).toBe("valid");
    if (result.kind !== "valid") throw new Error("预期完成 v5 迁移");
    expect(result.migrated).toBe(true);
    const restored = restoreUploadPlan(result.plan);
    expect(
      restored.chapters.map(({ action, status }) => [action, status]),
    ).toEqual(entries.map((entry) => entry.slice(2)));
    expect(encodeUploadCheckpoint(restored).version).toBe(6);
    expect(legacy.chapters[1]!.status).toBe("上传中");
  });

  it("保留不可重试的失败与已全部暂存的计划", () => {
    const value = fixture();
    value.chapters[0] = {
      ...value.chapters[0]!,
      status: "failed",
      error: "冲突",
      retryable: false,
    };
    const result = decodeUploadCheckpoint(value, "article");
    if (result.kind !== "valid") throw new Error("预期检查点有效");
    expect(restoreUploadPlan(result.plan).chapters[0]).toMatchObject({
      status: "failed",
      error: "冲突",
      retryable: false,
    });
    result.plan.chapters[0]!.status = "uploaded";
    expect(restoreUploadPlan(result.plan).chapters[0]!.status).toBe("uploaded");
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["字符串", "{}"],
    ["数组", []],
    ["未知版本", { ...fixture(), version: 7 }],
    ["不支持的旧版本", { ...fixture(), version: 4 }],
    ["其他文章", { ...fixture(), novelId: "other" }],
    ["缺少章节", { version: 6, novelId: "article", gaps: 0 }],
    ["章节为空", { ...fixture(), chapters: [] }],
    ["缺口数为负数", { ...fixture(), gaps: -1 }],
    ["缺口数为无穷大", { ...fixture(), gaps: Infinity }],
    ["缺口数为小数", { ...fixture(), gaps: 0.1 }],
    ["检查点含正文", { ...fixture(), content: "正文" }],
    [
      "标识重复",
      {
        ...fixture(),
        chapters: [...fixture().chapters, ...fixture().chapters],
      },
    ],
    ...[
      { id: "" },
      { order: 1 },
      { order: -1 },
      { hash: "invalid" },
      { hash: "" },
      { baseRevision: -1 },
      { attempts: 0.5 },
      { attempts: Number.MAX_SAFE_INTEGER + 1 },
      { title: null },
      { volumeTitle: 1 },
      { error: {} },
      { retryable: "yes" },
      { action: "新增" },
      { status: "待上传" },
      { action: "unknown" },
      { status: "unknown" },
      { action: "toString" },
      { status: "awaiting_replacement" },
      { status: "unchanged" },
      { content: { text: "body" } },
    ].map((patch): [string, unknown] => [
      JSON.stringify(patch),
      { ...fixture(), chapters: [{ ...fixture().chapters[0], ...patch }] },
    ]),
  ])("拒绝损坏的检查点：%s", (_name, value) => {
    expect(decodeUploadCheckpoint(value, "article").kind).toBe("invalid");
  });

  it("不将英文或原型属性名接受为 v5 中文代码", () => {
    for (const action of ["add", "toString", "__proto__"]) {
      expect(
        decodeUploadCheckpoint(
          {
            ...fixture(),
            version: 5,
            chapters: [{ ...fixture().chapters[0], action, status: "待上传" }],
          },
          "article",
        ).kind,
      ).toBe("invalid");
    }
  });

  it("区分记录缺失与数据损坏", () => {
    expect(decodeUploadCheckpoint(undefined, "article")).toEqual({
      kind: "missing",
    });
  });
});
