import type { Editor } from "@tiptap/react";
import { describe, expect, it, vi } from "vitest";
import {
  cmd,
  describeSteps,
  getSelectedNodeName,
  isContainerNodeActive,
  isRichNodeActive,
  type StepJson,
  unwrapOutermostReplyGate,
} from "./commands";

const step = (json: StepJson) => ({ toJSON: () => json });

function mockUnwrapEditor(selection: Record<string, unknown>) {
  const replaceWith = vi.fn();
  const dispatch = vi.fn();
  const run = vi.fn(() => true);
  const command = vi.fn(
    (callback: (props: { tr: { replaceWith: typeof replaceWith }; dispatch: typeof dispatch }) => boolean) => {
      callback({ tr: { replaceWith }, dispatch });
      return { run };
    },
  );
  const focus = vi.fn(() => ({ command }));
  return {
    editor: {
      state: { selection },
      chain: () => ({ focus }),
    } as unknown as Editor,
    replaceWith,
    dispatch,
    run,
  };
}

describe("describeSteps", () => {
  it("描述全部文字标记、属性修改和兜底步骤并去重", () => {
    const steps = [
      "bold",
      "italic",
      "underline",
      "strike",
      "spoiler",
      "link",
      "textStyle",
      "unknown",
    ].map((markType) => step({ stepType: "addMark", markType }));
    steps.push(
      step({ stepType: "removeMark" }),
      step({ stepType: "setNodeMarkup" }),
      step({ stepType: "attr" }),
      step({ stepType: "nodeAttr" }),
      step({ stepType: "other" }),
    );

    expect(describeSteps(steps)).toBe(
      "加粗、斜体、下划线、删除线、黑幕、链接、字体变化、文字格式、清除格式、修改属性、编辑",
    );
  });

  it("描述输入、换行、所有结构节点和删除操作", () => {
    const content = [
      "text",
      "hardBreak",
      "replyGate",
      "pollRef",
      "richImage",
      "attachmentRef",
      "diceRoll",
      "mention",
      "novelExcerpt",
      "inlineCommentAnchor",
      "heading",
      "blockquote",
      "bulletList",
      "orderedList",
      "horizontalRule",
    ].map((type) => ({ type }));
    expect(
      describeSteps([
        step({ stepType: "replace", slice: { content } }),
        step({ stepType: "replaceAround", slice: { content: [] } }),
        step({ stepType: "insert" }),
      ]),
    ).toBe(
      "输入、换行、回复可见、投票、图片、附件、骰子、提及、小说摘录、间贴锚点、标题、引用、列表、分隔线、删除",
    );
    expect(
      describeSteps([
        step({ stepType: "insert", slice: { content: [{ type: "unknown" }] } }),
      ]),
    ).toBe("编辑");
    expect(describeSteps([])).toBe("编辑");
  });
});

describe("editor command helpers", () => {
  it("包装可选编辑器命令并识别选中节点和容器状态", () => {
    const action = vi.fn(() => true);
    const editor = {
      state: { selection: { node: { type: { name: "richImage" } } } },
      isActive: vi.fn(() => true),
    } as unknown as Editor;

    cmd(null, action)();
    expect(action).not.toHaveBeenCalled();
    cmd(editor, action)();
    expect(action).toHaveBeenCalledWith(editor);
    expect(getSelectedNodeName(editor)).toBe("richImage");
    expect(isRichNodeActive(editor, "richImage")).toBe(true);
    expect(isRichNodeActive(editor, "pollRef")).toBe(false);
    expect(isContainerNodeActive(editor, "richImage")).toBe(true);
    expect(isContainerNodeActive(editor, "replyGate")).toBe(false);

    const cursorEditor = {
      state: { selection: {} },
      isActive: vi.fn((name: string) => name === "replyGate"),
    } as unknown as Editor;
    expect(getSelectedNodeName(cursorEditor)).toBeUndefined();
    expect(isContainerNodeActive(cursorEditor, "replyGate")).toBe(true);
  });

  it("解包光标所在的最外层回复可见容器", () => {
    const content = { size: 3 };
    const node = { type: { name: "replyGate" }, content };
    const nested = mockUnwrapEditor({
      $from: {
        depth: 2,
        node: (depth: number) =>
          depth === 1 ? node : { type: { name: "paragraph" } },
        before: () => 4,
        after: () => 10,
      },
    });

    expect(unwrapOutermostReplyGate(nested.editor)).toBe(true);
    expect(nested.replaceWith).toHaveBeenCalledWith(4, 10, content);
    expect(nested.dispatch).toHaveBeenCalled();
    expect(nested.run).toHaveBeenCalled();
  });

  it("解包直接选中的容器，并在没有容器时返回 false", () => {
    const content = { size: 2 };
    const selected = mockUnwrapEditor({
      $from: { depth: 0 },
      from: 2,
      to: 6,
      node: { type: { name: "replyGate" }, content },
    });
    expect(unwrapOutermostReplyGate(selected.editor)).toBe(true);
    expect(selected.replaceWith).toHaveBeenCalledWith(2, 6, content);

    const plain = mockUnwrapEditor({
      $from: {
        depth: 1,
        node: () => ({ type: { name: "paragraph" } }),
      },
      node: { type: { name: "richImage" }, content: {} },
    });
    expect(unwrapOutermostReplyGate(plain.editor)).toBe(false);
    expect(plain.replaceWith).not.toHaveBeenCalled();
  });
});
