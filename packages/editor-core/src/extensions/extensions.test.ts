import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";

import { editorExtensions } from "./index.js";

function createEditor(initialHtml = ""): Editor {
  return new Editor({
    extensions: editorExtensions(),
    content: initialHtml,
  });
}

/** 与修正后的服务端语义一致：null 属性视为「未设置」。 */
function normalizedStyleMarks(editor: Editor): Record<string, unknown>[] {
  const marks: Record<string, unknown>[] = [];
  const visit = (node: { marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: unknown[] }) => {
    for (const mark of node.marks ?? []) {
      if (mark.type !== "textStyle") continue;
      const attrs = Object.fromEntries(
        Object.entries(mark.attrs ?? {}).filter(([, value]) => value != null),
      );
      if (Object.keys(attrs).length > 0) marks.push(attrs);
    }
    for (const child of node.content ?? []) visit(child as never);
  };
  visit(editor.getJSON() as never);
  return marks;
}

describe("editorExtensions 粘贴入口白名单", () => {
  it("粘贴外部字体栈：白名单外的字体不进文档", () => {
    const editor = createEditor('<p><span style="font-family: Georgia, serif;">脏</span></p>');
    expect(normalizedStyleMarks(editor)).toEqual([]);
    editor.destroy();
  });

  it("粘贴字体栈首项在白名单内：取首项持久化", () => {
    const editor = createEditor('<p><span style=\'font-family: "Noto Serif SC", serif;\'>宋</span></p>');
    expect(normalizedStyleMarks(editor)).toEqual([{ fontFamily: "Noto Serif SC" }]);
    editor.destroy();
  });

  it("粘贴白名单内的单值字体：原样保留", () => {
    const editor = createEditor('<p><span style="font-family: Noto Serif SC Variable;">宋</span></p>');
    expect(normalizedStyleMarks(editor)).toEqual([{ fontFamily: "Noto Serif SC Variable" }]);
    editor.destroy();
  });

  it("粘贴字号：仅白名单内的整数 px 保留", () => {
    const rejected = createEditor('<p><span style="font-size: 15px;">a</span></p>');
    expect(normalizedStyleMarks(rejected)).toEqual([]);
    rejected.destroy();
    const accepted = createEditor('<p><span style="font-size: 18px;">a</span></p>');
    expect(normalizedStyleMarks(accepted)).toEqual([{ fontSize: "18px" }]);
    accepted.destroy();
    const nonPixel = createEditor('<p><span style="font-size: 10.5pt;">a</span></p>');
    expect(normalizedStyleMarks(nonPixel)).toEqual([]);
    nonPixel.destroy();
  });

  it("粘贴颜色：命名色与 rgba 不进文档，合法色保留", () => {
    const named = createEditor('<p><span style="color: red;">a</span></p>');
    expect(normalizedStyleMarks(named)).toEqual([]);
    named.destroy();
    const rgba = createEditor('<p><span style="color: rgba(1, 2, 3, 0.5);">a</span></p>');
    expect(normalizedStyleMarks(rgba)).toEqual([]);
    rgba.destroy();
    const hex = createEditor('<p><span style="color: #197c73;">a</span></p>');
    expect(normalizedStyleMarks(hex)).toEqual([{ color: "rgb(25, 124, 115)" }]);
    hex.destroy();
  });

  it("白名单内的组合粘贴：全部保留", () => {
    const editor = createEditor(
      '<p><span style="font-family: sans-serif; font-size: 16px; color: #197c73;">a</span></p>',
    );
    expect(normalizedStyleMarks(editor)).toEqual([
      { fontFamily: "sans-serif", fontSize: "16px", color: "rgb(25, 124, 115)" },
    ]);
    editor.destroy();
  });
});
