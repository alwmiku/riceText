import type { Editor } from "@tiptap/react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDocument } from "../../lib/seed";
import type { RichTextNode } from "../../lib/types";
import { RichTextEditor } from "./RichTextEditor";

/**
 * 工具栏按 ResizeObserver 报告的宽度决定是否折叠；jsdom 里宽度恒为 0，
 * 会直接落进紧凑布局，因此这里固定成桌面宽度。
 */
beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1024,
    height: 600,
    top: 0,
    left: 0,
    right: 1024,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function renderEditor(options: { editable?: boolean; mode?: "full" | "mobile" } = {}) {
  const onChange = vi.fn();
  let readyEditor: Editor | null = null;
  render(
    <RichTextEditor
      content={defaultDocument.content}
      mode={options.mode ?? "full"}
      editable={options.editable ?? true}
      onChange={onChange}
      onReady={(editor) => {
        readyEditor = editor;
      }}
    />,
  );
  return { onChange, editor: () => readyEditor as Editor | null };
}

describe("表情入口", () => {
  it("完整工具栏可打开表情面板并插入自定义表情节点", async () => {
    const { onChange, editor } = renderEditor();
    await screen.findByRole("toolbar", { name: "富文本工具栏" });
    await waitFor(() => expect(editor()).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "表情" }));
    const panel = await screen.findByRole("group", { name: "表情选择器" });
    expect(panel).toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: "抱抱" }));
    const json = editor()!.getJSON() as RichTextNode;
    const serialized = JSON.stringify(json);
    expect(serialized).toContain('"type":"emoji"');
    expect(serialized).toContain('"emojiId":"hug"');
    expect(onChange).toHaveBeenCalled();
  });

  it("纯文本表情（颜文字）以普通文本插入", async () => {
    const { editor } = renderEditor();
    await screen.findByRole("toolbar", { name: "富文本工具栏" });
    await waitFor(() => expect(editor()).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "表情" }));
    fireEvent.click(await screen.findByRole("tab", { name: "颜文字" }));
    fireEvent.click(screen.getByRole("option", { name: "抱抱" }));

    expect(JSON.stringify(editor()!.getJSON())).toContain("(づ｡◕‿‿◕｡)づ");
  });

  it("面板搜索可按快捷码命中", async () => {
    renderEditor();
    await screen.findByRole("toolbar", { name: "富文本工具栏" });
    fireEvent.click(screen.getByRole("button", { name: "表情" }));
    const search = await screen.findByLabelText("搜索表情");
    fireEvent.change(search, { target: { value: "bb" } });
    const option = within(screen.getByRole("listbox", { name: "表情列表" })).getAllByRole(
      "option",
    )[0]!;
    expect(option.getAttribute("aria-label")).toBe("抱抱");
  });

  it("工具栏其余插入入口仍然可用，且表情面板不会顶掉它们", async () => {
    const { editor } = renderEditor();
    await screen.findByRole("toolbar", { name: "富文本工具栏" });
    await waitFor(() => expect(editor()).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "附件" }));
    expect(screen.getByRole("dialog", { name: "插入附件" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    fireEvent.click(screen.getByRole("button", { name: "小说摘录" }));
    expect(screen.getByRole("dialog", { name: "插入小说摘录" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    fireEvent.click(screen.getByRole("button", { name: "投票" }));
    expect(screen.getByRole("dialog", { name: "创建投票" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    // 回复后可见：插入后光标落在门控内，激活判定与「取消回复可见」都要跟上。
    const json = () => JSON.stringify(editor()!.getJSON());
    fireEvent.click(screen.getByRole("button", { name: "回复后可见" }));
    expect(json()).toContain('"type":"replyGate"');
    // 光标进入门控后「取消回复可见」才可用：这里显式把光标放进节点内验证该判定。
    let gatePosition = -1;
    editor()!.state.doc.descendants((node, position) => {
      if (gatePosition < 0 && node.type.name === "replyGate") gatePosition = position;
      return true;
    });
    expect(gatePosition).toBeGreaterThanOrEqual(0);
    act(() => {
      editor()!.commands.setTextSelection(gatePosition + 2);
    });
    expect(screen.getByRole("button", { name: "取消回复可见" })).toBeEnabled();
  });

  it("选中已有节点时对话框走「更新属性」分支而不是再插入一个", async () => {
    const { editor } = renderEditor();
    await screen.findByRole("toolbar", { name: "富文本工具栏" });
    await waitFor(() => expect(editor()).not.toBeNull());

    // 直接构造已有节点并选中它，覆盖「编辑选中节点」的分支。
    act(() => {
      const instance = editor()!;
      instance.commands.insertRichImage({
        assetId: null,
        src: "/api/assets/existing/image",
        alt: "原图",
        caption: "旧说明",
        align: "center",
        width: 80,
      });
    });
    let imagePosition = -1;
    editor()!.state.doc.descendants((node, position) => {
      if (imagePosition < 0 && node.type.name === "richImage") imagePosition = position;
      return true;
    });
    expect(imagePosition).toBeGreaterThanOrEqual(0);
    act(() => {
      editor()!.commands.setNodeSelection(imagePosition);
    });

    fireEvent.click(screen.getByRole("button", { name: "图片" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑图片" });
    // 编辑分支会把已有值回填进表单。
    expect(within(dialog).getByLabelText(/链接|图片地址|地址/)).toHaveValue(
      "/api/assets/existing/image",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    const before = JSON.stringify(editor()!.getJSON());
    fireEvent.click(screen.getByRole("button", { name: "附件" }));
    const attachmentDialog = await screen.findByRole("dialog", { name: "插入附件" });
    fireEvent.click(within(attachmentDialog).getByRole("button", { name: "取消" }));

    // 取消不应改变正文。
    expect(JSON.stringify(editor()!.getJSON())).toBe(before);
  });

  it("只读编辑器不插入表情", async () => {
    const { onChange, editor } = renderEditor({ editable: false });
    await screen.findByRole("toolbar", { name: "富文本工具栏" });
    await waitFor(() => expect(editor()).not.toBeNull());
    const before = JSON.stringify(editor()!.getJSON());

    fireEvent.click(screen.getByRole("button", { name: "表情" }));
    fireEvent.click(await screen.findByRole("option", { name: "抱抱" }));

    expect(JSON.stringify(editor()!.getJSON())).toBe(before);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("移动端通过「插入内容」菜单打开表情面板", async () => {
    renderEditor({ mode: "mobile" });
    await screen.findByRole("button", { name: "更多工具" });

    // 移动端底部工具栏把「插入内容」折叠成一个下拉分组。
    fireEvent.pointerDown(screen.getByRole("button", { name: "插入内容" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(await screen.findByRole("menuitem", { name: "表情" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "颜文字" })).toBeNull();
  });
});
