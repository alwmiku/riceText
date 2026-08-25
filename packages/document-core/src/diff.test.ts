import { describe, expect, it } from "vitest";
import {
  applyStepsToDocument,
  describeStepsJson,
  diffDocuments,
  diffDocumentsVerified,
  sharedSchema,
  stepFromJson,
  validateSteps,
  type StepJson,
} from "./index.js";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/core";

const para = (text: string, marks?: JSONContent["marks"]): JSONContent =>
  marks
    ? { type: "paragraph", content: [{ type: "text", text, marks }] }
    : { type: "paragraph", content: [{ type: "text", text }] };

const doc = (blocks: JSONContent[]): JSONContent => ({
  type: "doc",
  content: blocks,
});

/** 与 PM 应用结果一致的规范化表示（补默认 attrs）。 */
function norm(json: JSONContent): JSONContent {
  return ProseMirrorNode.fromJSON(sharedSchema(), json).toJSON();
}

describe("diffDocuments", () => {
  it("相同文档不产生任何步骤", () => {
    const before = doc([para("潮声越过旧防波堤。")]);
    expect(diffDocuments(before, doc([para("潮声越过旧防波堤。")]))).toEqual([]);
  });

  it("段落内文字修改只替换变化的中间片段（最小操作）", () => {
    const before = doc([para("潮声越过旧防波堤时，灯塔正好熄灭。")]);
    const after = doc([para("潮声越过旧防波堤时，灯塔恰好熄灭。")]);
    const steps = diffDocuments(before, after);
    expect(steps).toHaveLength(1);
    const step = steps[0]!;
    expect(step.stepType).toBe("replace");
    expect(step.from).toBeLessThan(step.to!);
    // 公共前缀“潮声越过旧防波堤时，灯塔”与公共后缀“好熄灭。”不参与替换，
    // 只有“正”→“恰”进入 slice（块内第一个字符从 pos 1 开始）
    expect(step.from).toBe(13);
    expect(step.to).toBe(14);
    const slice = step.slice as { content?: Array<{ text?: string }> };
    expect(slice.content?.[0]?.text).toBe("恰");
  });

  it("整段文本变化时替换中间片段并保留公共尾部", () => {
    const before = doc([para("旧的内容"), para("保留的段落")]);
    const after = doc([para("全新的段落内容"), para("保留的段落")]);
    const steps = diffDocuments(before, after);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ stepType: "replace", from: 1, to: 3 });
    expect(applyStepsToDocument(sharedSchema(), before, steps)).toEqual(norm(after));
  });

  it("新增与删除块生成插入/删除步骤且可逆", () => {
    const before = doc([para("第一段"), para("第二段")]);
    const after = doc([para("插入在最前"), para("第一段"), para("第二段"), para("追加在最后")]);
    const steps = diffDocuments(before, after);
    const applied = applyStepsToDocument(sharedSchema(), before, steps);
    expect(applied).toEqual(norm(after));
    // 三个纯插入（头部两个 + 尾部一个）；“第一段→追加在最后”的删除与
    // 插入相邻衔接，被后处理合并为单个替换；第二段删除保留
    expect(steps.filter((step) => step.from === step.to)).toHaveLength(3);
    expect(steps).toHaveLength(5);

    const removed = diffDocuments(after, before);
    const appliedBack = applyStepsToDocument(sharedSchema(), after, removed);
    expect(appliedBack).toEqual(norm(before));
  });

  it("容器块（列表）变化时整块替换", () => {
    const before = doc([
      para("前文"),
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [para("甲")] },
          { type: "listItem", content: [para("乙")] },
        ],
      },
    ]);
    const after = doc([
      para("前文"),
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [para("甲")] },
          { type: "listItem", content: [para("乙改")] },
        ],
      },
    ]);
    const steps = diffDocuments(before, after);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ stepType: "replace" });
    expect(applyStepsToDocument(sharedSchema(), before, steps)).toEqual(norm(after));
  });

  it("mark 变化（整段加粗）整块替换", () => {
    const before = doc([para("普通文字")]);
    const after = doc([para("普通文字", [{ type: "bold" }])]);
    const steps = diffDocuments(before, after);
    expect(steps).toHaveLength(1);
    const applied = applyStepsToDocument(sharedSchema(), before, steps);
    expect(applied).toEqual(norm(after));
    // 文本相同的 mark 变化不能用纯文本切片表达，必须整块替换
    expect(steps[0]!.from).toBe(0);
    const slice = steps[0]!.slice as {
      content?: Array<{ content?: Array<{ marks?: unknown }> }>;
    };
    expect(slice.content?.[0]?.content?.[0]?.marks).toEqual([{ type: "bold" }]);
  });

  it("diff 结果可逆且精确（多种复合变更）", () => {
    const before = doc([
      para("第一段原文"),
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "标题" }] },
      para("第三段"),
      {
        type: "novelExcerpt",
        attrs: { bookTitle: "雾港来信", chapterTitle: "第一章", author: "林见", sourceUrl: null, variant: "desktop-book" },
        content: [para("摘录正文")],
      },
    ]);
    const after = doc([
      para("第一段改过了"),
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "标题变了" }] },
      para("插入的段落"),
      para("第三段"),
      {
        type: "novelExcerpt",
        attrs: { bookTitle: "雾港来信", chapterTitle: "第一章", author: "林见", sourceUrl: null, variant: "desktop-book" },
        content: [para("摘录正文修改")],
      },
    ]);
    const steps = diffDocumentsVerified(before, after);
    expect(steps.length).toBeGreaterThan(0);
    expect(applyStepsToDocument(sharedSchema(), before, steps)).toEqual(norm(after));
    // 完全可逆：反向 diff 也能精确还原
    const reverse = diffDocumentsVerified(after, before);
    expect(applyStepsToDocument(sharedSchema(), after, reverse)).toEqual(norm(before));
  });

  it("含行内原子节点（骰子/锚点）的段落退化为整块替换", () => {
    const before = doc([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "调查检定 " },
          {
            type: "diceRoll",
            attrs: { rollId: "roll_1", expression: "3d5", rolls: [4, 3, 5], total: 12, rerollOf: null },
          },
          { type: "text", text: "，线索足够。" },
        ],
      },
    ]);
    const after = doc([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "调查检定 " },
          {
            type: "diceRoll",
            attrs: { rollId: "roll_1", expression: "3d5", rolls: [4, 3, 5], total: 12, rerollOf: null },
          },
          { type: "text", text: "，线索已足够。" },
        ],
      },
    ]);
    const steps = diffDocuments(before, after);
    expect(applyStepsToDocument(sharedSchema(), before, steps)).toEqual(norm(after));
  });
});

describe("applyStepsToDocument", () => {
  const schema = sharedSchema();

  it("拒绝 position 越界的步骤", () => {
    const before = doc([para("正文")]);
    const bad: StepJson = {
      stepType: "replace",
      from: 999,
      to: 1000,
      slice: { type: "text", text: "" },
    };
    const result = validateSteps(schema, before, [bad]);
    expect(result).not.toBeNull();
    expect(result?.code).toBe("STEP_APPLY_FAILED");
    expect(() => applyStepsToDocument(schema, before, [bad])).toThrow(
      /应用失败/,
    );
  });

  it("拒绝未知步骤类型与非法 JSON", () => {
    const before = doc([para("正文")]);
    expect(validateSteps(schema, before, [{ stepType: "mystery" }])).toMatchObject({
      code: "INVALID_STEP",
    });
    expect(validateSteps(schema, before, [{ stepType: 42 } as never])).toMatchObject({
      code: "INVALID_STEP",
    });
  });

  it("拒绝破坏 schema 结构的步骤（文本进列表容器）", () => {
    const before = doc([para("正文")]);
    const bad = {
      stepType: "replace",
      from: 0,
      to: 1,
      slice: { type: "text", text: "裸文本" },
    };
    expect(validateSteps(schema, before, [bad])).toMatchObject({
      code: "STEP_APPLY_FAILED",
    });
  });

  it("从 JSON 恢复步骤并支持独立校验", () => {
    const step = stepFromJson(schema, {
      stepType: "replace",
      from: 0,
      to: 0,
      slice: { type: "paragraph", content: [{ type: "text", text: "插入" }] },
    });
    expect(step.toJSON().stepType).toBe("replace");
  });
});

describe("describeStepsJson", () => {
  it("描述文字修改、块插入与删除", () => {
    expect(
      describeStepsJson([
        { stepType: "replace", from: 1, to: 2, slice: { content: [{ type: "text" }] } },
      ]),
    ).toBe("修改文字");
    expect(
      describeStepsJson([
        { stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text" }] } },
      ]),
    ).toBe("插入文字");
    expect(
      describeStepsJson([
        { stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "richImage" }] } },
      ]),
    ).toBe("插入图片");
    expect(
      describeStepsJson([
        { stepType: "replace", from: 1, to: 5, slice: { content: [{ type: "paragraph" }] } },
      ]),
    ).toBe("替换段落");
  });
});
