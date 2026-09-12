import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { editorExtensions } from "@ricetext/editor-core";
import { findEmojiEntry } from "@ricetext/contracts";
import { emojiNodeAttributes, insertEmojiEntry, usesEmojiAsset } from "./emoji-insert";

let editor: Editor | null = null;

function createEditor(editable = true): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({
    element,
    extensions: editorExtensions(),
    content: { type: "doc", content: [{ type: "paragraph" }] },
    editable,
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
  window.localStorage.clear();
});

describe("表情插入动作", () => {
  it("emojiNodeAttributes 只对自定义表情产出节点属性", () => {
    const custom = findEmojiEntry("hug")!;
    expect(emojiNodeAttributes(custom)).toEqual({
      emojiId: "hug",
      name: "抱抱",
      src: "/api/emoji/hug/image",
      fallback: "🤗",
    });
    expect(usesEmojiAsset(custom)).toBe(true);
    const text = findEmojiEntry("smile")!;
    expect(emojiNodeAttributes(text)).toBeNull();
    expect(usesEmojiAsset(text)).toBe(false);
  });

  it("自定义表情写入 emoji 原子节点并记录最近使用", () => {
    const instance = createEditor();
    expect(insertEmojiEntry(instance, findEmojiEntry("water")!)).toBe(true);
    const node = instance.state.doc.firstChild?.firstChild;
    expect(node?.type.name).toBe("emoji");
    expect(node?.attrs.emojiId).toBe("water");
    expect(node?.attrs.src).toBe("/api/emoji/water/image");
    expect(instance.getHTML()).toContain('data-node-type="emoji"');
    expect(instance.getHTML()).toContain('alt="💧"');
    expect(JSON.parse(window.localStorage.getItem("ricetext:recent-emoji")!)).toEqual(["water"]);
  });

  it("表情不带尺寸属性：大小由字号决定", () => {
    const instance = createEditor();
    insertEmojiEntry(instance, findEmojiEntry("hug")!);
    const node = instance.state.doc.firstChild?.firstChild;
    // 节点只保留目录派生的四个属性，schema 里没有 size 这一项。
    expect(Object.keys(node?.attrs ?? {}).sort()).toEqual(["emojiId", "fallback", "name", "src"]);
    expect(instance.getHTML()).not.toContain("data-size");
  });

  it("字号直接放大表情：段落字号 128px 时表情渲染为 256px 高", () => {
    const instance = createEditor();
    insertEmojiEntry(instance, findEmojiEntry("hug")!);
    // 选中后设字号会套到行内原子节点上不生效，因此按真实用法把字号设在段落上。
    const emojiPos = instance.state.doc.firstChild?.firstChild;
    expect(emojiPos?.type.name).toBe("emoji");
    instance.commands.selectAll();
    instance.commands.setMark("textStyle", { fontSize: "128px" });
    instance.commands.setTextSelection(instance.state.doc.content.size - 1);
    const mark = instance.state.doc.firstChild?.firstChild?.marks[0];
    expect(mark?.attrs.fontSize).toBe("128px");
  });

  it("Unicode 表情与颜文字写入纯文本节点", () => {
    const instance = createEditor();
    insertEmojiEntry(instance, findEmojiEntry("smile")!);
    insertEmojiEntry(instance, findEmojiEntry("kao-hug")!);
    expect(instance.state.doc.textContent).toBe("😀(づ｡◕‿‿◕｡)づ");
    expect(instance.state.doc.firstChild?.firstChild?.type.name).toBe("text");
  });

  it("只读编辑器不插入也不记录最近使用", () => {
    const instance = createEditor(false);
    expect(insertEmojiEntry(instance, findEmojiEntry("hug")!)).toBe(false);
    expect(instance.state.doc.firstChild?.childCount).toBe(0);
    expect(window.localStorage.getItem("ricetext:recent-emoji")).toBeNull();
  });
});
