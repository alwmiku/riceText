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
