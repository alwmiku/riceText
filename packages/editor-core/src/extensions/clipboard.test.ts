import { Editor, Extension, type JSONContent } from "@tiptap/core";
import { AllSelection, Plugin, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { createEditorExtensions } from "./editor.js";

const editors: Editor[] = [];
// jsdom 没有 ClipboardEvent 构造器，显式事件仍走真实 ProseMirror 粘贴路径。
const pasteEvent = () => new Event("paste") as ClipboardEvent;
const format = { textAlign: "right", firstLineIndent: 2, leftIndent: 4 };
const text = (value: string): JSONContent => ({ type: "text", text: value });
function paragraph(value = "", attrs: Record<string, unknown> = {}): JSONContent {
  return { type: "paragraph", attrs, content: value ? [text(value)] : [] };
}
function create(content: JSONContent[] = [paragraph()], additionalExtensions: Extension[] = []) {
  const editor = new Editor({
    extensions: createEditorExtensions({ additionalExtensions }),
    content: { type: "doc", content },
  });
  editors.push(editor);
  return editor;
}
function copy(editor: Editor, from?: number, to?: number) {
  editor.view.dispatch(
    editor.state.tr.setSelection(
      from === undefined
        ? new AllSelection(editor.state.doc)
        : TextSelection.create(editor.state.doc, from, to),
    ),
  );
  return editor.view.serializeForClipboard(editor.state.selection.content());
}
function paste(source: Editor, target: Editor, from?: number, to?: number) {
  const clipboard = copy(source, from, to);
  expect(target.view.pasteHTML(clipboard.dom.innerHTML, pasteEvent())).toBe(true);
  return clipboard;
}
function blocks(editor: Editor) {
  const result: JSONContent[] = [];
  editor.state.doc.descendants((node) => {
    if (node.isTextblock) result.push(node.toJSON());
  });
  return result;
}
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

describe("共享剪贴板的 HTML 粘贴", () => {
  it.each([
    [1, 7, "abcdef"],
    [2, 5, "bcd"],
  ] as const)("选区 %i-%i 粘到空段落保留段落格式和选中文字", (from, to, expected) => {
    const source = create([paragraph("abcdef", format)]);
    const target = create();
    const clipboard = paste(source, target, from, to);
    expect(clipboard.dom.innerHTML).toContain('data-pm-slice="1 1 []"');
    expect(clipboard.text).toBe(expected);
    expect(blocks(target)).toEqual([
      { ...source.state.doc.firstChild!.toJSON(), content: [text(expected)] },
    ]);
    expect(target.state.selection.$from.parentOffset).toBe(expected.length);
    expect(target.commands.undo()).toBe(true);
    expect(target.state.doc.textContent).toBe("");
  });

  it("源段落默认格式也应覆盖空目标残留的对齐和缩进", () => {
    const source = create([paragraph("abcdef")]);
    const target = create([paragraph("", format)]);
    paste(source, target, 2, 5);
    expect(target.state.doc.firstChild!.attrs).toEqual(source.state.doc.firstChild!.attrs);
    expect(target.state.doc.textContent).toBe("bcd");
  });

  it("空文档 AllSelection 也保留源段落格式", () => {
    const source = create([paragraph("abcdef", format)]);
    const target = create();
    target.view.dispatch(target.state.tr.setSelection(new AllSelection(target.state.doc)));
    paste(source, target, 2, 5);
    expect(target.state.doc.firstChild!.attrs).toEqual(source.state.doc.firstChild!.attrs);
    expect(target.state.doc.textContent).toBe("bcd");
  });

  it("部分标题保留类型、级别、段落属性和行内格式", () => {
    const source = create([
      {
        type: "heading",
        attrs: { ...format, level: 2, chapterStart: true },
        content: [{ ...text("abcdef"), marks: [{ type: "bold" }, { type: "underline" }] }],
      },
    ]);
    const target = create();
    paste(source, target, 2, 5);
    expect(target.state.doc.firstChild!.type.name).toBe("heading");
    expect(target.state.doc.firstChild!.attrs).toEqual(source.state.doc.firstChild!.attrs);
    expect(target.state.doc.firstChild!.firstChild!.toJSON().marks).toEqual(
      source.state.doc.firstChild!.firstChild!.toJSON().marks,
    );
    expect(target.state.doc.textContent).toBe("bcd");
  });

  it("跨段落的部分选区保留首尾属性且不带未选文字", () => {
    const source = create([
      paragraph("abcdef", format),
      paragraph("uvwxyz", { ...format, textAlign: "center" }),
    ]);
    const target = create();
    paste(source, target, 3, 12);
    expect(blocks(target).map((node) => node.attrs)).toEqual(
      blocks(source).map((node) => node.attrs),
    );
    expect(target.state.doc.textContent).toBe("cdefuvw");
  });

  it("跨引用、小说、列表和代码块的选区保留首尾段落格式", () => {
    const source = create([
      paragraph("abcdef", format),
      { type: "blockquote", content: [paragraph("引用")] },
      {
        type: "novelExcerpt",
        attrs: { bookTitle: "书名" },
        content: [paragraph("小说正文", format)],
      },
      {
        type: "orderedList",
        attrs: { start: 5, type: "I" },
        content: [{ type: "listItem", content: [paragraph("列表", format)] }],
      },
      { type: "codeBlock", content: [text("代码\n  第二行")] },
      paragraph("uvwxyz", { ...format, textAlign: "center" }),
    ]);
    const target = create();
    const end = source.state.doc.content.size - 4;
    const clipboard = paste(source, target, 3, end);
    expect(clipboard.slice.openStart).toBe(1);
    expect(clipboard.slice.openEnd).toBe(1);
    expect(target.state.doc.content.toJSON()).toEqual(clipboard.slice.content.toJSON());
    expect(target.state.doc.firstChild!.textContent).toBe("cdef");
    expect(target.state.doc.lastChild!.textContent).toBe("uvw");
  });

  it.each([1, 4, 7])("非空目标的光标位置 %i 沿用目标段落属性", (pos) => {
    const source = create([paragraph("abcdef", format)]);
    const target = create([
      paragraph("TARGET", { textAlign: "center", firstLineIndent: 6, leftIndent: 8 }),
    ]);
    const attrs = { ...target.state.doc.firstChild!.attrs };
    target.commands.setTextSelection(pos);
    paste(source, target, 2, 5);
    expect(target.state.doc.firstChild!.attrs).toEqual(attrs);
    expect(target.state.doc.textContent).toBe(
      `TARGET`.slice(0, pos - 1) + "bcd" + `TARGET`.slice(pos - 1),
    );
  });

  it("选中非空目标全文仍沿用目标段落属性", () => {
    const source = create([paragraph("abcdef", format)]);
    const target = create([paragraph("TARGET", { textAlign: "center" })]);
    const attrs = { ...target.state.doc.firstChild!.attrs };
    target.commands.setTextSelection({ from: 1, to: 7 });
    paste(source, target, 2, 5);
    expect(target.state.doc.firstChild!.attrs).toEqual(attrs);
    expect(target.state.doc.textContent).toBe("bcd");
  });

  it("普通外部 HTML 不触发段落格式修复", () => {
    const source = create([paragraph("abcdef", format)]);
    const target = create();
    const clipboard = copy(source, 2, 5);
    clipboard.dom.querySelector("[data-pm-slice]")!.removeAttribute("data-pm-slice");
    const attrs = { ...target.state.doc.firstChild!.attrs };
    target.view.pasteHTML(clipboard.dom.innerHTML, pasteEvent());
    expect(target.state.doc.firstChild!.attrs).toEqual(attrs);
    expect(target.state.doc.textContent).toBe("bcd");
  });

  it("纯文本粘贴不注入之前 HTML 的格式", () => {
    const source = create([paragraph("abcdef", format)]);
    const target = create();
    const clipboard = paste(source, target, 2, 5);
    target.commands.setContent({ type: "doc", content: [paragraph()] });
    const attrs = { ...target.state.doc.firstChild!.attrs };
    target.view.pasteText(clipboard.text, pasteEvent());
    expect(target.state.doc.firstChild!.attrs).toEqual(attrs);
    expect(target.state.doc.textContent).toBe("bcd");
  });

  it("代码块目标保留原生纯文本语义", () => {
    const source = create([paragraph("abcdef", format)]);
    const target = create([{ type: "codeBlock" }]);
    const clipboard = copy(source, 2, 5);
    // 原生粘贴事件同时携带 HTML 和 plain，代码块选择 plain。
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        getData: (type: string) =>
          type === "text/html" ? clipboard.dom.innerHTML : clipboard.text,
        files: [],
      },
    });
    target.view.dom.dispatchEvent(event);
    expect(target.state.doc.firstChild!.type.name).toBe("codeBlock");
    expect(target.state.doc.textContent).toBe("bcd");
    expect(target.state.doc.firstChild!.firstChild!.marks).toEqual([]);
  });

  it("代码块来源交由原生逻辑处理", () => {
    const source = create([{ type: "codeBlock", content: [text("abcdef")] }]);
    const target = create();
    paste(source, target, 2, 5);
    expect(target.state.doc.textContent).toBe("bcd");
    expect(target.state.doc.firstChild!.attrs.textAlign ?? null).toBe(null);
  });

  it.each([false, true])("列表部分选区保持原生上下文，非空列表目标=%s", (nonempty) => {
    const list = (
      value: string,
      attrs: Record<string, unknown>,
      paragraphAttrs: Record<string, unknown>,
    ): JSONContent => ({
      type: "orderedList",
      attrs,
      content: [
        {
          type: "listItem",
          attrs: { textAlign: "center" },
          content: [paragraph(value, paragraphAttrs)],
        },
      ],
    });
    const source = create([list("abcdef", { start: 5, type: "I" }, format)]);
    const target = create(
      nonempty ? [list("TARGET", { start: 1, type: "a" }, { textAlign: "left" })] : undefined,
    );
    if (nonempty) target.commands.setTextSelection(6);
    const targetAttrs = blocks(target)[0]!.attrs;
    paste(source, target, 4, 7);
    expect(target.state.doc.textContent).toBe(nonempty ? "TARbcdGET" : "bcd");
    expect(target.state.doc.firstChild!.attrs).toMatchObject(
      nonempty ? { start: 1, type: "a" } : { start: 5, type: "I" },
    );
    expect(blocks(target)[0]!.attrs).toEqual(
      nonempty ? targetAttrs : source.state.doc.firstChild!.firstChild!.firstChild!.attrs,
    );
  });

  it.each([null, "id-123"])("可空 atom 属性 %s 经 HTML 往返保持值", (id) => {
    const source = create([
      {
        type: "richImage",
        attrs: { assetId: id, src: "/uploads/image.png", alt: "图", caption: "图注" },
      },
      {
        type: "paragraph",
        content: [
          { type: "mention", attrs: { userId: id, name: "名字" } },
          { type: "diceRoll", attrs: { rerollOf: id, expression: "1d6", total: 4, rolls: [4] } },
        ],
      },
    ]);
    const target = create();
    paste(source, target);
    expect(target.getJSON()).toEqual(source.getJSON());
  });
});

describe("共享剪贴板的纯文本序列化", () => {
  it("输出所有自定义 leaf 正文和实际评论数，并保留空段落及换行", () => {
    const source = create([
      { type: "longTextBlock", attrs: { title: "标题不替代正文", text: "  长文\n\n第二段\t  " } },
      paragraph(),
      paragraph(),
      {
        type: "paragraph",
        content: [
          text("前 "),
          { type: "mention", attrs: { name: "小明" } },
          text(" "),
          { type: "diceRoll", attrs: { expression: "2d6", total: 7 } },
          { type: "hardBreak" },
          { type: "inlineCommentAnchor", attrs: { count: 0 } },
          text("/"),
          { type: "inlineCommentAnchor", attrs: { count: 12 } },
          text(" 后  "),
        ],
      },
      { type: "attachmentRef", attrs: { name: "附件.txt" } },
      {
        type: "pollRef",
        attrs: {
          question: "问题",
          options: [
            { id: "a", label: "选项 A" },
            { id: "b", label: "选项\nB" },
          ],
        },
      },
      { type: "richImage", attrs: { alt: "替代文本", caption: "图注" } },
      paragraph(),
    ]);
    const target = create();
    const clipboard = copy(source);
    expect(clipboard.text).toBe(
      [
        "  长文\n\n第二段\t  ",
        "",
        "",
        "前 @小明 2d6 = 7\n0/12 后  ",
        "附件.txt",
        "问题\n选项 A\n选项\nB",
        "替代文本\n图注",
        "",
      ].join("\n\n"),
    );
    target.view.pasteText(clipboard.text, pasteEvent());
    expect(target.state.doc.textContent).toContain("@小明 2d6 = 7");
    expect(target.state.doc.textContent).toContain("附件.txt");
  });

  it("只输出选中的 atom 与文字，排除相邻节点", () => {
    const source = create([
      {
        type: "paragraph",
        content: [
          text("before"),
          { type: "mention", attrs: { name: "选中用户" } },
          text("after"),
          { type: "diceRoll", attrs: { expression: "1d6", total: 6 } },
        ],
      },
    ]);
    const target = create();
    const clipboard = paste(source, target, 6, 10);
    expect(clipboard.text).toBe("e@选中用户af");
    expect(target.state.doc.firstChild!.child(1).type.name).toBe("mention");
    expect(target.state.doc.textContent).toBe("eaf");
  });

  it("序列化传入的部分 slice，不读取当前全选范围", () => {
    const source = create([
      paragraph("abcdef"),
      { type: "longTextBlock", attrs: { text: "未选正文" } },
    ]);
    copy(source);
    const slice = TextSelection.create(source.state.doc, 2, 5).content();
    expect(source.view.serializeForClipboard(slice).text).toBe("bcd");
  });

  it("追加的自定义序列化插件和直接 editorProps 保持优先", () => {
    const custom = Extension.create({
      name: "customClipboard",
      addProseMirrorPlugins: () => [
        new Plugin({ props: { clipboardTextSerializer: () => "自定义正文" } }),
      ],
    });
    const source = create([paragraph("原文")], [custom]);
    expect(copy(source).text).toBe("自定义正文");
    source.view.setProps({ clipboardTextSerializer: () => "直接配置" });
    expect(copy(source).text).toBe("直接配置");
  });
});
