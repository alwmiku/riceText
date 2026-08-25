import { describe, expect, it } from "vitest";
import {
  applySuggestionsToLine,
  diffChars,
  splitChars,
  type CharDiffOp,
} from "./char-diff";
import type { ForumSuggestion } from "../../lib/api";

/** 应用 diff 后的文本（去掉删除字）。 */
function appliedText(ops: readonly CharDiffOp[]): string {
  return ops
    .filter((op) => op.type !== "delete")
    .map((op) => op.text)
    .join("");
}

/** 原始文本（去掉插入字）。 */
function originalText(ops: readonly CharDiffOp[]): string {
  return ops
    .filter((op) => op.type !== "insert")
    .map((op) => op.text)
    .join("");
}

describe("splitChars", () => {
  it("中文逐字切分，连续英文/数字按词", () => {
    expect(splitChars("雾港2026a")).toEqual(["雾", "港", "2026a"]);
  });

  it("标点符号逐字符切分", () => {
    expect(splitChars("你好，世界！")).toEqual([
      "你",
      "好",
      "，",
      "世",
      "界",
      "！",
    ]);
  });

  it("空文本返回空数组", () => {
    expect(splitChars("")).toEqual([]);
  });
});

describe("diffChars", () => {
  it("无变化时只有 equal", () => {
    const ops = diffChars("潮声越过旧防波堤", "潮声越过旧防波堤");
    expect(ops).toEqual([{ type: "equal", text: "潮声越过旧防波堤" }]);
  });

  it("替换只删除旧字并插入新字（字级最小单元）", () => {
    const ops = diffChars("灯塔正好熄灭", "灯塔恰好熄灭");
    expect(appliedText(ops)).toBe("灯塔恰好熄灭");
    expect(originalText(ops)).toBe("灯塔正好熄灭");
    expect(ops).toContainEqual({ type: "delete", text: "正" });
    expect(ops).toContainEqual({ type: "insert", text: "恰" });
    // 未变化的“灯塔”与“好熄灭”保持 equal，与变化片段混排
    // （LCS 以“好”为公共字，因此 delete/insert 只覆盖真正变化的字）
    expect(ops).toContainEqual({ type: "equal", text: "灯塔" });
    expect(ops).toContainEqual({ type: "equal", text: "好熄灭" });
  });

  it("纯插入与纯删除", () => {
    const inserted = diffChars("线索足够。", "线索已足够。");
    expect(inserted).toContainEqual({ type: "insert", text: "已" });
    expect(appliedText(inserted)).toBe("线索已足够。");

    const deleted = diffChars("线索已足够。", "线索足够。");
    expect(deleted).toContainEqual({ type: "delete", text: "已" });
    expect(appliedText(deleted)).toBe("线索足够。");
  });

  it("多字增删在一个片段内聚合并", () => {
    const ops = diffChars("旅人把信压在灯下", "旅人把信压在油灯下");
    expect(appliedText(ops)).toBe("旅人把信压在油灯下");
    expect(originalText(ops)).toBe("旅人把信压在灯下");
    expect(ops).toContainEqual({ type: "insert", text: "油" });
  });

  it("相邻 equal 片段会合并，顺序为 equal/delete/insert 交替", () => {
    const ops = diffChars("今天天气很好", "今天阳光很好");
    expect(appliedText(ops)).toBe("今天阳光很好");
    expect(originalText(ops)).toBe("今天天气很好");
    const types = ops.map((op) => op.type);
    // 相邻同类已合并
    for (let index = 1; index < types.length; index += 1) {
      expect(types[index]).not.toBe(types[index - 1]);
    }
  });
});

const suggestion = (overrides: Partial<ForumSuggestion>): ForumSuggestion => ({
  id: "s1",
  documentId: "demo-post",
  chapterId: "chapter-0",
  chapterTitle: "正文",
  lineNo: 2,
  lineText: "潮声越过旧防波堤时，灯塔正好熄灭。",
  fromText: "正好",
  toText: "恰好",
  reason: "",
  status: "pending",
  authorId: "reader",
  reviewerId: null,
  createdAt: "2026-08-20T08:00:00.000Z",
  ...overrides,
});

describe("applySuggestionsToLine", () => {
  it("只替换 fromText 第一次出现的位置", () => {
    expect(
      applySuggestionsToLine("正好，还有另一个正好。", [suggestion({})]),
    ).toBe("恰好，还有另一个正好。");
  });

  it("同一行的多个建议依次应用", () => {
    const result = applySuggestionsToLine("潮声越过旧防波堤时，灯塔正好熄灭。", [
      suggestion({ fromText: "潮声", toText: "涛声" }),
      suggestion({ fromText: "正好", toText: "恰好" }),
    ]);
    expect(result).toBe("涛声越过旧防波堤时，灯塔恰好熄灭。");
  });

  it("行内不存在的文本保持不变", () => {
    expect(
      applySuggestionsToLine("无关的一行。", [suggestion({})]),
    ).toBe("无关的一行。");
  });
});
