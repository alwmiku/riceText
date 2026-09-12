import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { editorExtensions } from "./extensions/editor.js";
import {
  RANGE_SELECTION_ATTRIBUTE,
  RangeSelectionHighlight,
} from "./extensions/range-selection.js";

/**
 * 与 Web 宿主一致地挂载扩展：选区高亮是宿主通过 `additionalExtensions` 加进来的，
 * 不属于 editorExtensions() 的规范组合（schema 一致性测试锁定该组合不变）。
 */
function hostExtensions() {
  return editorExtensions({ additionalExtensions: [RangeSelectionHighlight] });
}

/** 建一个可编辑编辑器，返回按装饰属性收集的节点类型。 */
function decoratedTypes(content: Record<string, unknown>): string[] {
  const editor = new Editor({ extensions: hostExtensions(), content });
  const attribute = editor.view.dom.querySelectorAll(`[${RANGE_SELECTION_ATTRIBUTE}]`);
  const types = Array.from(attribute, (element) => element.getAttribute(RANGE_SELECTION_ATTRIBUTE));
  editor.destroy();
  return types as string[];
}

const emoji = {
  type: "emoji",
  attrs: { emojiId: "hug", name: "抱抱", src: "/api/emoji/hug/image", fallback: "🤗" },
};
const dice = {
  type: "diceRoll",
  attrs: { rollId: "r1", expression: "3d5", rolls: [3, 4, 5], total: 12, rerollOf: null },
};

/** 用 TextSelection 覆盖整篇文档后读取装饰。 */
function selectAllAndCollect(content: Record<string, unknown>): string[] {
  const editor = new Editor({ extensions: hostExtensions(), content });
  const { state, view } = editor;
  const selection = TextSelection.create(state.doc, 1, state.doc.content.size - 1);
  view.dispatch(state.tr.setSelection(selection));
  const types = Array.from(view.dom.querySelectorAll(`[${RANGE_SELECTION_ATTRIBUTE}]`), (element) =>
    element.getAttribute(RANGE_SELECTION_ATTRIBUTE),
  ) as string[];
  editor.destroy();
  return types;
}

describe("跨选区原子节点高亮", () => {
  it("文本选区跨过表情与骰子时都给它们加装饰", () => {
    const types = selectAllAndCollect({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "这是" },
            emoji,
            { type: "text", text: "下划线" },
            dice,
            { type: "text", text: "结尾" },
          ],
        },
      ],
    });
    expect(types).toContain("emoji");
    expect(types).toContain("diceRoll");
  });

  it("光标收起时没有装饰", () => {
    expect(
      decoratedTypes({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "这是" }, emoji, { type: "text", text: "下划线" }],
          },
        ],
      }),
    ).toEqual([]);
  });

  it("只选中表情一侧的文字时不会误标表情", () => {
    const editor = new Editor({
      extensions: hostExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "abcd" }, emoji, { type: "text", text: "efgh" }],
          },
        ],
      },
    });
    const { state, view } = editor;
    // 只选 "abcd"（段落内第 1..5 个位置），不跨越表情。
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 5)));
    expect(view.dom.querySelectorAll(`[${RANGE_SELECTION_ATTRIBUTE}]`).length).toBe(0);
    editor.destroy();
  });
});
