import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findEmojiEntry } from "@ricetext/contracts";
import { editorExtensions, type EmojiStorage, type EmojiTriggerState } from "./index.js";

let editor: Editor | null = null;

/** 创建带触发插件的最小编辑器，并挂上宿主回调。 */
function createEditor(onTrigger?: (state: EmojiTriggerState) => void): {
  editor: Editor;
  storage: EmojiStorage;
  states: EmojiTriggerState[];
} {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({
    element,
    extensions: editorExtensions(),
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  const storage = (editor.storage as unknown as { emoji: EmojiStorage }).emoji;
  const states: EmojiTriggerState[] = [];
  storage.onTrigger = (state) => {
    states.push(state);
    onTrigger?.(state);
  };
  return { editor, storage, states };
}

/**
 * 逐字符输入，模拟真实按键产生的多笔事务。
 * 光标必须落在刚插入的文字之后（打字时的默认行为），否则触发前缀的区间会偏一位。
 */
function typeText(instance: Editor, text: string): void {
  for (const character of text) {
    const { state } = instance.view;
    const { from, to } = state.selection;
    const tr = state.tr.insertText(character, from, to);
    // 打字时光标始终停在段末；显式设置避免 `insertText` 默认选区产生的偏移。
    const paragraphEnd = tr.doc.content.size - 1;
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(from, paragraphEnd))));
    instance.view.dispatch(tr);
  }
}

/** 直接派发 DOM 键盘事件，走 ProseMirror 的 keydown 通道。 */
function pressKey(instance: Editor, key: string): void {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  instance.view.dom.dispatchEvent(event);
}

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
});

describe("emoji 触发插件", () => {
  it("输入 hh 后打开候选浮层，并推给宿主回调", () => {
    const { editor: instance, states } = createEditor();
    typeText(instance, "hh");
    const last = states.at(-1)!;
    expect(last.open).toBe(true);
    expect(last.query).toBe("");
    // 查询为空时区间收缩在光标处：from === to，插入时只删除前缀本身。
    expect(last.to).toBe(last.from);
    // 未输入查询词时按前缀 hh 筛候选：站点微笑表情排第一。
    expect(last.items[0]!.id).toBe("shy-sticker");
    expect(last.items.length).toBeLessThanOrEqual(8);
  });

  it("继续输入会缩小候选范围；无匹配时自动关闭", () => {
    const { editor: instance, states } = createEditor();
    typeText(instance, "hhzh");
    expect(states.at(-1)!.query).toBe("zh");
    expect(states.at(-1)!.open).toBe(true);
    typeText(instance, "zzz");
    expect(states.at(-1)!.open).toBe(false);
  });

  it("回车插入当前高亮候选，并连同 hh 前缀一起替换", () => {
    const { editor: instance, states } = createEditor();
    typeText(instance, "hh");
    pressKey(instance, "Enter");
    expect(instance.state.doc.firstChild?.childCount).toBe(1);
    const node = instance.state.doc.firstChild?.firstChild;
    expect(node?.type.name).toBe("emoji");
    expect(node?.attrs.emojiId).toBe("shy-sticker");
    // 前缀必须被完全吃掉：只留下表情节点，没有残留的 h。
    expect(instance.state.doc.textContent).toBe("");
    expect(states.at(-1)!.open).toBe(false);
  });

  it("带查询词时连同前缀一起替换，且不残留查询文字", () => {
    const { editor: instance } = createEditor();
    typeText(instance, "hhpc");
    pressKey(instance, "Enter");
    expect(instance.state.doc.textContent).toBe("");
    expect(instance.state.doc.firstChild?.firstChild?.attrs.emojiId).toBe("pfft");
  });

  it("方向键移动高亮，Enter 插入移动后的候选", () => {
    const { editor: instance, states } = createEditor();
    typeText(instance, "hh");
    expect(states.at(-1)!.activeIndex).toBe(0);
    pressKey(instance, "ArrowDown");
    // 高亮移动到第二个候选后回车，插入的必须是第二个而不是第一个。
    expect(states.at(-1)!.activeIndex).toBe(1);
    const second = states.at(-1)!.items[1]!.id;
    pressKey(instance, "Enter");
    expect(instance.state.doc.firstChild?.firstChild?.attrs.emojiId).toBe(second);
  });

  it("Escape 关闭浮层且不改动正文", () => {
    const { editor: instance, states } = createEditor();
    typeText(instance, "hh");
    pressKey(instance, "Escape");
    expect(states.at(-1)!.open).toBe(false);
    expect(instance.state.doc.textContent).toBe("hh");
  });

  it("宿主通过 storage 回填选择与移动高亮", () => {
    const { editor: instance, storage, states } = createEditor();
    typeText(instance, "hh");
    expect(storage.setActiveIndex(1)).toBe(true);
    expect(states.at(-1)!.activeIndex).toBe(1);
    expect(storage.setActiveIndex(999)).toBe(false);
    expect(storage.applyPick("pfft")).toBe(true);
    expect(instance.state.doc.firstChild?.firstChild?.attrs.emojiId).toBe("pfft");
    // 浮层已关闭，再次回填应当失败。
    expect(storage.applyPick("pfft")).toBe(false);
  });

  it("纯文本条目经命令插入为字符而非节点", () => {
    const { editor: instance } = createEditor();
    expect(instance.commands.insertEmojiFromQuery("kao-hug")).toBe(true);
    expect(instance.state.doc.textContent).toBe("(づ｡◕‿‿◕｡)づ");
    expect(instance.commands.insertEmojiFromQuery("no-such-emoji")).toBe(false);
  });

  it("Tab 与 Enter 行为一致：插入当前高亮候选", () => {
    const { editor: instance } = createEditor();
    typeText(instance, "hh");
    pressKey(instance, "Tab");
    expect(instance.state.doc.textContent).toBe("");
    expect(instance.state.doc.firstChild?.firstChild?.type.name).toBe("emoji");
  });

  it("浮层未打开时键盘与 storage 回填都是空操作", () => {
    const { editor: instance, storage } = createEditor();
    // 无触发器状态：方向键、回车、storage 调用都必须原样放行。
    pressKey(instance, "ArrowDown");
    pressKey(instance, "Enter");
    pressKey(instance, "Tab");
    expect(storage.applyPick("hug")).toBe(false);
    expect(storage.setActiveIndex(0)).toBe(false);
    expect(instance.state.doc.textContent).toBe("");
  });

  it("中文输入法合成期间不触发（view.composing 为真）", () => {
    const { editor: instance, states } = createEditor();
    const storage = (instance.storage as unknown as { emoji: EmojiStorage }).emoji;
    const onTrigger = vi.fn();
    storage.onTrigger = onTrigger;
    Object.defineProperty(instance.view, "composing", { configurable: true, value: true });
    typeText(instance, "hh");
    expect(states.every((state) => !state.open)).toBe(true);
  });

  it("insertEmoji 命令写入完整节点属性", () => {
    const { editor: instance } = createEditor();
    const entry = findEmojiEntry("water")!;
    expect(
      instance.commands.insertEmoji({
        emojiId: entry.id,
        name: entry.name,
        src: `/api/emoji/${entry.id}/image`,
        fallback: entry.text,
      }),
    ).toBe(true);
    const node = instance.state.doc.firstChild?.firstChild;
    expect(node?.attrs.name).toBe("浇水");
    expect(node?.attrs.fallback).toBe("💧");
  });
});
