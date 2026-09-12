import { Editor, type JSONContent } from "@tiptap/core";
import { editorExtensions, sanitizeDocument } from "@ricetext/editor-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FONT_SIZE_RANGE } from "./editor-tool-definitions";
import { copySelection, pasteSelection, setFontSize, setFontSizeFromInput } from "./editor-actions";

const editors: Editor[] = [];
const write = vi.fn();
const writeText = vi.fn();
let copied: Record<string, Blob>;
class ClipboardItemStub {
  constructor(items: Record<string, Blob>) {
    copied = items;
  }
}
function makeEditor(content: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }) {
  const editor = new Editor({ extensions: editorExtensions(), content });
  editors.push(editor);
  return editor;
}
const blobText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
async function pasteCopied(target: Editor) {
  const html = await blobText(copied["text/html"]!);
  target.commands.selectAll();
  expect(target.view.pasteHTML(html, new Event("paste") as ClipboardEvent)).toBe(true);
  return html;
}

beforeEach(() => {
  write.mockReset().mockResolvedValue(undefined);
  writeText.mockReset();
  vi.stubGlobal("ClipboardItem", ClipboardItemStub);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { write, writeText },
  });
});
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("字号应用", () => {
  it("光标状态作用到整段，让贴着表情改字号也能放大它", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "前文" },
            {
              type: "emoji",
              attrs: { emojiId: "hug", name: "抱抱", src: "/api/emoji/hug/image", fallback: "🤗" },
            },
          ],
        },
      ],
    });
    // 光标停在段落末尾（插入表情后的自然位置），选区为空。
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(editor.state.selection.empty).toBe(true);

    expect(setFontSize(editor, "400px")).toBe(true);
    // 字号是 textStyle mark，落在段内文本上；表情靠 em 继承同一字号放大。
    const paragraph = editor.state.doc.firstChild!;
    const sizeMarks: (string | undefined)[] = [];
    paragraph.descendants((node) => {
      if (node.isText)
        sizeMarks.push(node.marks.find((m) => m.type.name === "textStyle")?.attrs.fontSize);
      return true;
    });
    expect(sizeMarks).toContain("400px");
    expect(editor.getHTML()).toContain("font-size: 400px");

    // 之后继续输入的文字也沿用这个字号。
    editor.commands.insertContent("后续");
    expect(editor.getHTML()).toContain("font-size: 400px");
  });

  it("有选区时只作用于选中文字，不改变整段字号", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "前半后半" }],
        },
      ],
    });
    editor.commands.setTextSelection({ from: 1, to: 3 });
    expect(setFontSize(editor, "32px")).toBe(true);
    const first = editor.state.doc.firstChild?.firstChild;
    expect(first?.marks[0]?.attrs.fontSize).toBe("32px");
    // 段落本身不该被整段标记。
    expect(editor.state.doc.firstChild?.attrs.fontSize).toBeUndefined();
  });

  it("自定义输入按白名单区间收窄，无法解析时保留原值", () => {
    // 需要段内已有文本节点：字号是 textStyle mark，空段落无处落笔。
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }],
    });
    editor.commands.setTextSelection(1);
    const fontSizeInDoc = () =>
      editor.state.doc.firstChild?.firstChild?.marks.find((mark) => mark.type.name === "textStyle")
        ?.attrs.fontSize as string | undefined;
    expect(setFontSizeFromInput(editor, "400")).toBe(400);
    expect(fontSizeInDoc()).toBe("400px");
    expect(setFontSizeFromInput(editor, "9999")).toBe(FONT_SIZE_RANGE.max);
    expect(setFontSizeFromInput(editor, "1")).toBe(FONT_SIZE_RANGE.min);
    expect(setFontSizeFromInput(editor, "0")).toBe(FONT_SIZE_RANGE.min);
    expect(setFontSizeFromInput(editor, "abc")).toBeNull();
    // 上一次生效的值保持不变（未解析的值不落库）。
    expect(fontSizeInDoc()).toBe("12px");
  });
});

describe("浮动工具栏富文本复制", () => {
  it("复制完整文本、空行、混合标记和全部段落格式到另一编辑器", async () => {
    const source = makeEditor(
      sanitizeDocument({
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: {
              level: 2,
              chapterStart: true,
              textAlign: "center",
              firstLineIndent: 2,
              leftIndent: 4,
            },
            content: [{ type: "text", text: "第七章 完整格式" }],
          },
          {
            type: "paragraph",
            attrs: { textAlign: "justify", firstLineIndent: 2, leftIndent: 6 },
            content: [
              {
                type: "text",
                text: "  粗斜下划线  ",
                marks: [
                  { type: "bold" },
                  { type: "italic" },
                  { type: "underline" },
                  { type: "strike" },
                ],
              },
              {
                type: "text",
                text: "字体字号与颜色",
                marks: [
                  {
                    type: "textStyle",
                    attrs: { fontFamily: "SimSun", fontSize: "24px", color: "#123456" },
                  },
                ],
              },
              { type: "hardBreak" },
              {
                type: "text",
                text: "链接",
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: "https://example.com/source",
                      target: "_blank",
                      rel: "noopener noreferrer nofollow",
                    },
                  },
                ],
              },
              { type: "text", text: "黑幕内容", marks: [{ type: "spoiler" }] },
              { type: "text", text: "行内代码", marks: [{ type: "code" }] },
            ],
          },
          { type: "paragraph" },
          {
            type: "orderedList",
            attrs: { start: 4, type: "A" },
            content: [
              {
                type: "listItem",
                attrs: { textAlign: "right" },
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "编号与嵌套" }] },
                  {
                    type: "bulletList",
                    content: [
                      {
                        type: "listItem",
                        content: [{ type: "paragraph", content: [{ type: "text", text: "子项" }] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "blockquote",
            content: [{ type: "paragraph", content: [{ type: "text", text: "引用原文" }] }],
          },
          {
            type: "codeBlock",
            attrs: { language: "javascript" },
            content: [{ type: "text", text: "const n = 1;\n  n + 2;" }],
          },
          { type: "horizontalRule" },
          { type: "paragraph", content: [{ type: "text", text: "末尾全文 😀" }] },
        ],
      }),
    );
    source.commands.selectAll();
    const before = source.getJSON();
    const selection = source.state.selection.toJSON();
    expect(await copySelection(source)).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(Object.keys(copied)).toEqual(["text/html", "text/plain"]);
    const target = makeEditor();
    const html = await pasteCopied(target);
    expect(html).toContain("data-pm-slice");
    expect(target.getJSON()).toEqual(before);
    expect(source.getJSON()).toEqual(before);
    expect(source.state.selection.toJSON()).toEqual(selection);
    expect(await blobText(copied["text/plain"]!)).toContain("末尾全文 😀");
  });

  it("完整保留自定义节点正文、来源、显示属性和稳定实体标识", async () => {
    const source = makeEditor(
      sanitizeDocument({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "提及与骰子" },
              {
                type: "mention",
                attrs: {
                  userId: "reader",
                  name: "读者",
                  resolved: true,
                  avatarUrl: "https://example.com/avatar.png",
                },
              },
              {
                type: "diceRoll",
                attrs: {
                  rollId: "roll-1",
                  expression: "2d6",
                  rolls: [3, 4],
                  total: 7,
                  rerollOf: "roll-0",
                },
              },
              {
                type: "inlineCommentAnchor",
                attrs: { threadId: "thread-1", count: 8, placement: "start" },
              },
            ],
          },
          {
            type: "richImage",
            attrs: {
              assetId: "asset-1",
              src: "https://example.com/image.png",
              alt: "图片替代文字",
              caption: "图片说明",
              width: 75,
              align: "right",
            },
          },
          {
            type: "novelExcerpt",
            attrs: {
              variant: "sfacg",
              bookTitle: "书名",
              chapterTitle: "第七章",
              author: "作者",
              sourceUrl: "https://example.com/chapter",
              readerTime: "12:34",
              batteryLevel: 73,
              pageLabel: "3/7",
              progressLabel: "30%",
              headerLabel: "自定义",
            },
            content: [
              {
                type: "paragraph",
                attrs: { textAlign: "center", leftIndent: 2 },
                content: [{ type: "text", text: "摘录全文", marks: [{ type: "bold" }] }],
              },
            ],
          },
          {
            type: "replyGate",
            attrs: { gateId: "gate-1", prompt: "回复提示" },
            content: [{ type: "paragraph", content: [{ type: "text", text: "回复可见正文" }] }],
          },
          {
            type: "attachmentRef",
            attrs: {
              attachmentId: "file-1",
              name: "附件.pdf",
              mimeType: "application/pdf",
              size: 2048,
              priceCoins: 7,
            },
          },
          {
            type: "pollRef",
            attrs: {
              pollId: "poll-1",
              question: "选择什么",
              multiple: true,
              options: ["选项一", "选项二"],
            },
          },
          {
            type: "longTextBlock",
            attrs: {
              chapterId: "long-1",
              title: "长文章节",
              volumeTitle: "第一卷",
              text: "第一行\n第二行  连续空格\n最后一行",
              order: 2,
              start: 10,
              end: 48,
            },
          },
          { type: "paragraph" },
        ],
      }),
    );
    source.commands.selectAll();
    expect(await copySelection(source)).toBe(true);
    const target = makeEditor();
    await pasteCopied(target);
    expect(target.getJSON()).toEqual(source.getJSON());
  });

  it("部分混合格式选区只复制被选中的文字并保留标记", async () => {
    const source = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "不要复制" },
            { type: "text", text: "粗体", marks: [{ type: "bold" }] },
            { type: "text", text: "斜体", marks: [{ type: "italic" }] },
            { type: "text", text: "也不复制" },
          ],
        },
      ],
    });
    source.commands.setTextSelection({ from: 5, to: 9 });
    expect(await copySelection(source)).toBe(true);
    expect(await blobText(copied["text/plain"]!)).toBe("粗体斜体");
    const target = makeEditor();
    await pasteCopied(target);
    expect(target.state.doc.textContent).toBe("粗体斜体");
    expect(target.getJSON().content?.[0]?.content).toEqual([
      { type: "text", text: "粗体", marks: [{ type: "bold" }] },
      { type: "text", text: "斜体", marks: [{ type: "italic" }] },
    ]);
  });

  it("透明文字颜色经富文本复制、粘贴和净化后保持原值", async () => {
    const source = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "透明色",
              marks: [{ type: "textStyle", attrs: { color: "#12345680" } }],
            },
          ],
        },
      ],
    });
    source.commands.selectAll();
    expect(await copySelection(source)).toBe(true);
    const target = makeEditor();
    await pasteCopied(target);
    expect(target.getJSON()).toEqual(source.getJSON());
    expect(
      sanitizeDocument(target.getJSON()).content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.color,
    ).toBe("#12345680");
  });

  it("颜色元数据仍拒绝危险值且安全行内颜色可作为回退", () => {
    const editor = new Editor({
      extensions: editorExtensions(),
      content:
        '<p><span style="color: rgb(1, 2, 3)" data-text-color="url(javascript:alert(1))">安全回退</span></p>',
    });
    editors.push(editor);
    expect(editor.getJSON().content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.color).toBe(
      "rgb(1, 2, 3)",
    );
  });

  it("权限等待期间改变选区也保持点击复制时的快照", async () => {
    let finish!: () => void;
    write.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const source = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "原始文字" }] }],
    });
    source.commands.selectAll();
    const copying = copySelection(source);
    source.commands.setContent("<p>后续编辑</p>");
    finish();
    expect(await copying).toBe(true);
    expect(await blobText(copied["text/plain"]!)).toBe("原始文字");
  });

  it("粘贴按钮优先采用 HTML，而不是读取同剪贴板中的纯文本", async () => {
    vi.stubGlobal("ClipboardEvent", Event);
    const source = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "格式内容", marks: [{ type: "bold" }] }],
        },
      ],
    });
    source.commands.selectAll();
    await copySelection(source);
    const html = await blobText(copied["text/html"]!);
    const readText = vi.fn();
    const getType = vi.fn(async () => ({ text: async () => html }));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { read: async () => [{ types: ["text/plain", "text/html"], getType }], readText },
    });
    const target = makeEditor();
    expect(await pasteSelection(target)).toBe(true);
    expect(target.getJSON()).toEqual(source.getJSON());
    expect(getType).toHaveBeenCalledWith("text/html");
    expect(readText).not.toHaveBeenCalled();
  });

  it("纯文本剪贴板按文字和段落粘贴，不把尖括号当 HTML", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: async () => "<b>原样</b>\n第二行" },
    });
    const target = makeEditor();
    target.commands.selectAll();
    expect(await pasteSelection(target)).toBe(true);
    expect(target.state.doc.content.content.map((node) => node.textContent)).toEqual([
      "<b>原样</b>",
      "第二行",
    ]);
    expect(target.getJSON().content?.[0]?.content?.[0]?.marks).toBeUndefined();
  });

  it("粘贴权限被拒绝或读取时目标已变更，不降级也不写入错误选区", async () => {
    let finish!: (items: unknown[]) => void;
    const readText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
        readText,
      },
    });
    const target = makeEditor();
    const pasting = pasteSelection(target);
    target.commands.setContent("<p>新内容</p>");
    finish([
      { types: ["text/html"], getType: async () => ({ text: async () => "<p>旧粘贴</p>" }) },
    ]);
    expect(await pasting).toBe(false);
    expect(target.state.doc.textContent).toBe("新内容");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: async () => {
          throw new Error("拒绝");
        },
        readText,
      },
    });
    expect(await pasteSelection(target)).toBe(false);
    expect(readText).not.toHaveBeenCalled();
  });

  it("无选区、编辑器已销毁或权限被拒绝时返回失败，不悄悄降级成纯文本", async () => {
    const source = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "完整文字" }] }],
    });
    expect(await copySelection(source)).toBe(false);
    expect(write).not.toHaveBeenCalled();
    source.commands.selectAll();
    write.mockRejectedValueOnce(new DOMException("没有剪贴板权限", "NotAllowedError"));
    expect(await copySelection(source)).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    source.destroy();
    expect(await copySelection(source)).toBe(false);
  });

  it("没有异步剪贴板接口时用复制事件同时写入两种格式并清理监听器", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    const source = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "兼容复制", marks: [{ type: "bold" }] }],
        },
      ],
    });
    source.commands.selectAll();
    const setData = vi.fn();
    const remove = vi.spyOn(document, "removeEventListener");
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => {
        const event = new Event("copy", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "clipboardData", { value: { clearData: vi.fn(), setData } });
        document.dispatchEvent(event);
        return true;
      }),
    });
    expect(await copySelection(source)).toBe(true);
    expect(setData).toHaveBeenCalledWith(
      "text/html",
      expect.stringContaining("<strong>兼容复制</strong>"),
    );
    expect(setData).toHaveBeenCalledWith("text/plain", "兼容复制");
    expect(remove).toHaveBeenCalledWith("copy", expect.any(Function), true);
    remove.mockRestore();
  });
});
