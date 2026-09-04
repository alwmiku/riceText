import type { Editor } from "@tiptap/react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type * as ApiModule from "../../lib/api";
import { validateDocument } from "@ricetext/document-core";
import { defaultDocument } from "../../lib/seed";
import type { RichTextNode } from "../../lib/types";
import { CompactInsertMenu, RichTextEditor } from "./RichTextEditor";

const { createDiceMock, uploadAssetMock } = vi.hoisted(() => ({
  createDiceMock: vi.fn(),
  uploadAssetMock: vi.fn(),
}));

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof ApiModule>("../../lib/api");
  return {
    ...actual,
    createDice: createDiceMock,
    uploadAsset: uploadAssetMock,
  };
});

beforeAll(() => {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {
        /* empty */
      },
    }),
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 0, 0, 0),
  });
});

describe("RichTextEditor presets", () => {
  beforeEach(() => {
    createDiceMock.mockReset();
    uploadAssetMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("完整模式展示全工具栏并执行格式与插入命令", async () => {
    const onChange = vi.fn();
    const editorRef: { current: Editor | null } = { current: null };
    render(
      <RichTextEditor
        content={defaultDocument.content}
        mode="full"
        onChange={onChange}
        onReady={(value) => {
          editorRef.current = value;
        }}
      />,
    );

    expect(
      await screen.findByRole("toolbar", { name: "富文本工具栏" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("正文编辑区")).toHaveAttribute(
      "contenteditable",
      "true",
    );
    expect(screen.getByLabelText("字号")).toHaveValue("16px");
    expect(screen.getByLabelText("字体")).toHaveValue("");
    for (const label of [
      "加粗",
      "斜体",
      "下划线",
      "一级标题",
      "二级标题",
      "无序列表",
      "有序列表",
      "引用",
      "分割线",
      "左对齐",
      "居中",
      "右对齐",
      "间贴锚点",
      "@ 用户",
      "黑幕",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }

    await waitFor(() => expect(editorRef.current).not.toBeNull());
    const readyEditor = editorRef.current;
    if (!readyEditor) throw new Error("编辑器未初始化");
    // 未选中文字时插入链接：弹出「未选择文字」提示，不打开链接输入框
    fireEvent.click(screen.getByRole("button", { name: "链接" }));
    const noSelectionAlert = await screen.findByRole("alertdialog");
    expect(noSelectionAlert).toHaveTextContent("未选择文字");
    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "分割线" }));
    await waitFor(() =>
      expect(
        onChange.mock.calls.some(([document]) =>
          JSON.stringify(document).includes('"type":"horizontalRule"'),
        ),
      ).toBe(true),
    );
    fireEvent.change(screen.getByLabelText("字号"), {
      target: { value: "20px" },
    });
    fireEvent.change(screen.getByLabelText("字体"), {
      target: { value: "Noto Serif SC Variable" },
    });
    expect(screen.getByLabelText("字体")).toHaveValue("Noto Serif SC Variable");
    fireEvent.click(screen.getByRole("button", { name: "加粗" }));
    fireEvent.click(screen.getByRole("button", { name: "间贴锚点" }));
    act(() => {
      if (!readyEditor) throw new Error("编辑器未初始化");
      readyEditor.commands.insertContent("真实输入");
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it("选中文字后插入链接，文档能通过保存校验", async () => {
    const editorRef: { current: Editor | null } = { current: null };
    render(
      <RichTextEditor
        content={defaultDocument.content}
        mode="full"
        onChange={vi.fn()}
        onReady={(value) => {
          editorRef.current = value;
        }}
      />,
    );
    await waitFor(() => expect(editorRef.current).not.toBeNull());
    const readyEditor = editorRef.current;
    if (!readyEditor) throw new Error("编辑器未初始化");
    readyEditor.commands.setTextSelection({ from: 1, to: 12 });

    fireEvent.click(screen.getByRole("button", { name: "链接" }));
    const linkDialog = await screen.findByRole("dialog");
    const linkInput = within(linkDialog).getByLabelText("链接地址");
    expect(linkInput).toHaveValue("https://");
    fireEvent.change(linkInput, {
      target: { value: "javascript:alert(1)" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("仅允许 HTTP(S) 链接");
    expect(
      within(linkDialog).getByRole("button", { name: "插入链接" }),
    ).toBeDisabled();
    fireEvent.change(linkInput, {
      target: { value: "https://ricetext.dev" },
    });
    fireEvent.click(
      within(linkDialog).getByRole("button", { name: "插入链接" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    expect(readyEditor.getAttributes("link").href).toBe(
      "https://ricetext.dev",
    );
    // 链接 mark 的属性必须落在持久化契约白名单（href/target/rel）内，
    // 否则保存校验 fail-closed 会拒绝整篇文档。
    const validation = validateDocument(readyEditor.getJSON());
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);
  });

  it("完整模式可以从工具栏打开骰子、图片与提及对话框", async () => {
    render(
      <RichTextEditor
        content={defaultDocument.content}
        mode="full"
        onChange={vi.fn()}
      />,
    );
    await screen.findByRole("toolbar");

    fireEvent.click(screen.getByRole("button", { name: "骰子" }));
    expect(
      screen.getByRole("dialog", { name: "插入骰子" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    fireEvent.click(screen.getByRole("button", { name: "图片" }));
    expect(
      screen.getByRole("dialog", { name: "插入图片" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    fireEvent.click(screen.getByRole("button", { name: "@ 用户" }));
    expect(
      screen.getByRole("dialog", { name: "提及用户" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  });

  it("极简模式隐藏工具栏并提供发布和展开入口", async () => {
    const onSubmit = vi.fn();
    const onExpand = vi.fn();
    const onModeToolsOpen = vi.fn();
    render(
      <RichTextEditor
        content={defaultDocument.content}
        mode="compact"
        onChange={vi.fn()}
        onSubmit={onSubmit}
        onExpand={onExpand}
        onModeToolsOpen={onModeToolsOpen}
      />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("快速回复编辑区")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "发布回复" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(screen.getByRole("button", { name: /更多/ }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "切换完整编辑器" }),
    );
    expect(onExpand).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(screen.getByRole("button", { name: /更多/ }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "插入图片或骰子" }),
    );
    expect(onModeToolsOpen).toHaveBeenCalledTimes(1);
  });

  it("未选中文本时右键仍显示自定义编辑命令", async () => {
    render(
      <RichTextEditor
        content={defaultDocument.content}
        mode="full"
        onChange={vi.fn()}
      />,
    );

    const editorElement = await screen.findByLabelText("正文编辑区");
    fireEvent.contextMenu(editorElement, { clientX: 120, clientY: 140 });
    expect(
      await screen.findByRole("menu", { name: "编辑上下文菜单" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /全选/ })).toBeInTheDocument();
  });

  it("右键插入子菜单复用图片对话框", async () => {
    render(
      <RichTextEditor
        content={defaultDocument.content}
        mode="full"
        onChange={vi.fn()}
      />,
    );

    const editorElement = await screen.findByLabelText("正文编辑区");
    fireEvent.contextMenu(editorElement, { clientX: 120, clientY: 140 });
    const insertTrigger = await screen.findByRole("menuitem", {
      name: "插入内容",
    });
    // Radix 子菜单仅在 pointerType 为 mouse 的指针移动时打开（100ms 定时器）。
    fireEvent.pointerMove(insertTrigger, { pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "图片" }));
    expect(
      await screen.findByRole("dialog", { name: "插入图片" }),
    ).toBeInTheDocument();
  });

  it("文本选区通过右键菜单提供字体、字号和颜色", async () => {
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 100, 40, 24),
    );
    const editorRef: { current: Editor | null } = { current: null };
    render(
      <RichTextEditor
        content={defaultDocument.content}
        mode="full"
        onChange={vi.fn()}
        onReady={(value) => {
          editorRef.current = value;
        }}
      />,
    );

    await waitFor(() => expect(editorRef.current).not.toBeNull());
    const readyEditor = editorRef.current;
    if (!readyEditor) throw new Error("编辑器未初始化");
    readyEditor.commands.setTextSelection({ from: 1, to: 4 });
    expect(
      await screen.findByRole("toolbar", { name: "选区浮动工具栏" }),
    ).toBeInTheDocument();
    const editorElement = screen.getByLabelText("正文编辑区");
    fireEvent.contextMenu(editorElement, { clientX: 120, clientY: 140 });

    expect(
      await screen.findByRole("menu", { name: "选区格式菜单" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("选区字体")).toBeInTheDocument();
    expect(screen.getByLabelText("选区字号")).toBeInTheDocument();
    // 右键菜单是 modal，会把浮动工具栏标为 aria-hidden；getByLabelText 不按
    // 无障碍树过滤，仍能断言浮动工具栏上的拾色器触发按钮。
    expect(screen.getByLabelText("选区文字颜色")).toBeInTheDocument();
  });

  it("桌面编辑区变窄时按组折叠工具栏", async () => {
    class TestResizeObserver {
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe() {
        this.callback([], this as unknown as ResizeObserver);
      }

      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 600, 46),
    );

    render(
      <RichTextEditor
        content={defaultDocument.content}
        mode="full"
        onChange={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "更多工具" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加粗" })).toHaveAttribute(
      "data-size",
      "icon-sm",
    );
  });

  it("移动端选中文本后直接显示自定义格式工具栏", async () => {
    const editorRef: { current: Editor | null } = { current: null };
    render(
      <RichTextEditor
        content={defaultDocument.content}
        mode="mobile"
        onChange={vi.fn()}
        onReady={(value) => {
          editorRef.current = value;
        }}
      />,
    );

    await waitFor(() => expect(editorRef.current).not.toBeNull());
    const readyEditor = editorRef.current;
    if (!readyEditor) throw new Error("编辑器未初始化");
    readyEditor.commands.setTextSelection({ from: 1, to: 4 });
    expect(
      await screen.findByRole("toolbar", { name: "选区格式菜单" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("选区字体")).toBeInTheDocument();
    expect(screen.getByLabelText("选区字号")).toBeInTheDocument();
    // 悬浮工具栏的拾色器是紧凑「色块 + 箭头」入口（色块行在展开面板里）
    expect(screen.getByLabelText("应用选区文字颜色")).toBeInTheDocument();
    expect(screen.getByLabelText("选区文字颜色")).toBeInTheDocument();
  });

  it("章节从空壳异步装载正文时不误弹选区格式菜单", async () => {
    const editorRef: { current: Editor | null } = { current: null };
    const props = {
      mode: "mobile" as const,
      onChange: vi.fn(),
      onReady: (value: Editor | null) => {
        editorRef.current = value;
      },
    };
    const { rerender } = render(
      <RichTextEditor
        {...props}
        content={{ type: "doc", content: [] }}
      />,
    );
    await waitFor(() => expect(editorRef.current).not.toBeNull());

    rerender(
      <RichTextEditor {...props} content={defaultDocument.content} />,
    );
    await screen.findByText(/潮声越过旧防波堤/);

    expect(editorRef.current?.state.selection.empty).toBe(true);
    expect(
      screen.queryByRole("toolbar", { name: "选区格式菜单" }),
    ).not.toBeInTheDocument();
  });

  it("移动端长按不会打开右键菜单并保留选区工具栏", async () => {
    const editorRef: { current: Editor | null } = { current: null };
    render(
      <RichTextEditor
        content={defaultDocument.content}
        mode="mobile"
        onChange={vi.fn()}
        onReady={(value) => {
          editorRef.current = value;
        }}
      />,
    );

    await waitFor(() => expect(editorRef.current).not.toBeNull());
    const readyEditor = editorRef.current;
    if (!readyEditor) throw new Error("编辑器未初始化");
    readyEditor.commands.setTextSelection({ from: 1, to: 4 });
    expect(
      await screen.findByRole("toolbar", { name: "选区格式菜单" }),
    ).toBeInTheDocument();

    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 140,
    });
    screen.getByLabelText("正文编辑区").dispatchEvent(contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(
      screen.getByRole("toolbar", { name: "选区格式菜单" }),
    ).toBeInTheDocument();
  });

  it("移动模式使用大尺寸底部工具栏并通过菜单展开工具", async () => {
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    render(
      <RichTextEditor
        content={defaultDocument.content}
        mode="mobile"
        onChange={onChange}
        onSubmit={onSubmit}
      />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("正文编辑区")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("toolbar", { name: "富文本工具栏" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加粗" })).toHaveAttribute(
      "data-size",
      "icon-lg",
    );
    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(screen.getByRole("button", { name: "插入内容" }), {
      button: 0,
      ctrlKey: false,
    });
    const insertMenu = await screen.findByRole("menu");
    fireEvent.click(within(insertMenu).getByRole("menuitem", { name: "分割线" }));
    await waitFor(() =>
      expect(
        onChange.mock.calls.some(([document]) =>
          JSON.stringify(document).includes('"type":"horizontalRule"'),
        ),
      ).toBe(true),
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "更多工具" }), {
      button: 0,
      ctrlKey: false,
    });
    const mobileMenu = await screen.findByRole("menu");
    expect(mobileMenu).toHaveAttribute("data-side", "top");
    expect(screen.getByRole("menuitem", { name: /撤销/ })).toBeInTheDocument();
  });

  it("移动端通过「插入内容 → 链接」对话框插入链接", async () => {
    const editorRef: { current: Editor | null } = { current: null };
    render(
      <RichTextEditor
        content={defaultDocument.content}
        mode="mobile"
        onChange={vi.fn()}
        onReady={(value) => {
          editorRef.current = value;
        }}
      />,
    );
    await waitFor(() => expect(editorRef.current).not.toBeNull());
    const readyEditor = editorRef.current;
    if (!readyEditor) throw new Error("编辑器未初始化");
    readyEditor.commands.setTextSelection({ from: 1, to: 4 });

    fireEvent.pointerDown(screen.getByRole("button", { name: "插入内容" }), {
      button: 0,
      ctrlKey: false,
    });
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /链接/ }));

    const linkDialog = await screen.findByRole("dialog");
    fireEvent.change(within(linkDialog).getByLabelText("链接地址"), {
      target: { value: "https://example.com/mobile" },
    });
    fireEvent.click(
      within(linkDialog).getByRole("button", { name: "插入链接" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(readyEditor.getAttributes("link").href).toBe(
      "https://example.com/mobile",
    );
  });

  it("只读状态同步到 ProseMirror，空的紧凑插入菜单不渲染", async () => {
    const { container } = render(
      <>
        <RichTextEditor
          content={defaultDocument.content}
          mode="full"
          editable={false}
          onChange={vi.fn()}
        />
        <CompactInsertMenu editor={null} />
      </>,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("正文编辑区")).toHaveAttribute(
        "contenteditable",
        "false",
      ),
    );
    expect(container.querySelectorAll('[role="toolbar"]')).toHaveLength(1);
  });

  it("切换编辑权限时不把权限事务上报为正文修改", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RichTextEditor
        content={defaultDocument.content}
        mode="full"
        editable={false}
        onChange={onChange}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("正文编辑区")).toHaveAttribute(
        "contenteditable",
        "false",
      ),
    );
    onChange.mockClear();

    rerender(
      <RichTextEditor
        content={defaultDocument.content}
        mode="full"
        editable
        onChange={onChange}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("正文编辑区")).toHaveAttribute(
        "contenteditable",
        "true",
      ),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("宿主切换版本时无事件地同步受控正文", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RichTextEditor
        content={defaultDocument.content}
        mode="full"
        onChange={onChange}
      />,
    );
    await screen.findByText("雾港来信：第三章讨论与校订");
    onChange.mockClear();

    const replacement: RichTextNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "回滚后的正文" }],
        },
      ],
    };
    rerender(
      <RichTextEditor content={replacement} mode="full" onChange={onChange} />,
    );

    expect(await screen.findByText("回滚后的正文")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("桌面工具栏拾色器把选中的颜色写入选区", async () => {
    window.localStorage.clear();
    const editorRef: { current: Editor | null } = { current: null };
    render(
      <RichTextEditor
        content={defaultDocument.content}
        mode="full"
        onChange={vi.fn()}
        onReady={(value) => {
          editorRef.current = value;
        }}
      />,
    );

    await waitFor(() => expect(editorRef.current).not.toBeNull());
    const readyEditor = editorRef.current;
    if (!readyEditor) throw new Error("编辑器未初始化");
    readyEditor.commands.setTextSelection({ from: 1, to: 4 });
    fireEvent.click(screen.getByRole("button", { name: "文字颜色" }));
    expect(await screen.findByLabelText("拾色器")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("文字颜色 #197c73"));
    expect(readyEditor.getAttributes("textStyle").color).toBe("#197c73");
  });

  it("移动端文字格式菜单：颜色带色块（点击直用）与箭头子菜单（完整取色面板）", async () => {
    window.localStorage.clear();
    const editorRef: { current: Editor | null } = { current: null };
    render(
      <RichTextEditor
        content={defaultDocument.content}
        mode="mobile"
        onChange={vi.fn()}
        onReady={(value) => {
          editorRef.current = value;
        }}
      />,
    );

    await waitFor(() => expect(editorRef.current).not.toBeNull());
    const readyEditor = editorRef.current;
    if (!readyEditor) throw new Error("编辑器未初始化");
    readyEditor.commands.setTextSelection({ from: 1, to: 4 });
    fireEvent.pointerDown(screen.getByRole("button", { name: "文字格式" }), {
      button: 0,
      ctrlKey: false,
    });
    const menu = await screen.findByRole("menu");
    // 1. 色块按钮直接应用记忆色
    fireEvent.click(within(menu).getByRole("button", { name: "应用文字颜色" }));
    expect(readyEditor.getAttributes("textStyle").color).toBe("#20272c");
    // 2. 点「颜色」菜单项 → 独立取色弹层（含 SV 矩形）
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^颜色$/ }));
    const panel = await screen.findByLabelText("拾色器");
    expect(
      within(panel).getByRole("slider", { name: "饱和度与亮度" }),
    ).toBeInTheDocument();
    // 3. 面板内已存色块点击应用
    fireEvent.click(within(panel).getByLabelText("文字颜色 #197c73"));
    expect(readyEditor.getAttributes("textStyle").color).toBe("#197c73");
  });

  it("移动端文字格式菜单：在取色弹层内按下 SV 矩阵不关闭菜单", async () => {
    window.localStorage.clear();
    const editorRef: { current: Editor | null } = { current: null };
    render(
      <RichTextEditor
        content={defaultDocument.content}
        mode="mobile"
        onChange={vi.fn()}
        onReady={(value) => {
          editorRef.current = value;
        }}
      />,
    );

    await waitFor(() => expect(editorRef.current).not.toBeNull());
    const readyEditor = editorRef.current;
    if (!readyEditor) throw new Error("编辑器未初始化");
    readyEditor.commands.setTextSelection({ from: 1, to: 4 });
    fireEvent.pointerDown(screen.getByRole("button", { name: "文字格式" }), {
      button: 0,
      ctrlKey: false,
    });
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^颜色$/ }));
    const panel = await screen.findByLabelText("拾色器");
    const sv = within(panel).getByRole("slider", { name: "饱和度与亮度" });

    // 取色弹层已注册为菜单的 DismissableLayer branch：
    // 在 SV 矩阵上按下/拖动不算「点击菜单外部」，斜体菜单保持打开。
    fireEvent.pointerDown(sv, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 40,
      clientY: 40,
    });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByLabelText("拾色器")).toBeInTheDocument();
  });
});
