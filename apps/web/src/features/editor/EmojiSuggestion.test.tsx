import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions, type EmojiStorage, type EmojiTriggerState } from "@ricetext/editor-core";
import { EmojiSuggestion } from "./EmojiSuggestion";

let editor: Editor | null = null;

function createEditor(): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({
    element,
    extensions: editorExtensions(),
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  return editor;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
  window.localStorage.clear();
});

/** 直接把触发器状态推给宿主浮层，避免依赖真实按键时序。 */
function pushState(instance: Editor, state: Partial<EmojiTriggerState>) {
  const storage = (instance.storage as unknown as { emoji: EmojiStorage }).emoji;
  const items = state.items ?? [];
  act(() => {
    storage.onTrigger?.({
      open: state.open ?? items.length > 0,
      query: state.query ?? "",
      from: state.from ?? 1,
      to: state.to ?? 1,
      items,
      activeIndex: state.activeIndex ?? 0,
    });
  });
}

describe("EmojiSuggestion 触发浮层", () => {
  it("关闭状态不渲染任何东西，缺少编辑器时也不抛错", () => {
    const { container, unmount } = render(<EmojiSuggestion editor={null} />);
    expect(container).toBeEmptyDOMElement();
    unmount();

    const instance = createEditor();
    const { container: host } = render(<EmojiSuggestion editor={instance} />);
    expect(host).toBeEmptyDOMElement();
    pushState(instance, { open: false, items: [] });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("打开时渲染候选、标注当前高亮与快捷码", () => {
    const instance = createEditor();
    render(<EmojiSuggestion editor={instance} />);
    pushState(instance, {
      from: 1,
      items: [
        {
          id: "hug",
          groupId: "custom",
          name: "微笑",
          keywords: [],
          text: "🙂",
          shortcodes: ["hh"],
        },
        { id: "water", groupId: "custom", name: "火热", keywords: [], text: "🔥" },
      ],
      activeIndex: 1,
    });

    const listbox = screen.getByRole("listbox", { name: "表情候选" });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]!.getAttribute("aria-selected")).toBe("false");
    expect(options[1]!.getAttribute("aria-selected")).toBe("true");
    expect(listbox.textContent).toContain(":hh");
    expect(options[1]!.textContent).not.toContain(":hh");
  });

  it("悬停移动高亮、点击回填候选（回填后浮层自动关闭）", () => {
    const instance = createEditor();
    render(<EmojiSuggestion editor={instance} />);
    act(() => {
      instance.commands.insertContent("hh");
    });
    expect(screen.getByRole("listbox", { name: "表情候选" })).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getAllByRole("option")[1]!);
    expect(screen.getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getAllByRole("option")[1]!);
    expect(instance.state.doc.firstChild?.firstChild?.type.name).toBe("emoji");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("坐标不可用时退回视口内的默认位置，仍然可点击", () => {
    const instance = createEditor();
    const coords = vi.spyOn(instance.view, "coordsAtPos").mockImplementation(() => {
      throw new Error("no layout in jsdom");
    });
    render(<EmojiSuggestion editor={instance} />);
    pushState(instance, {
      from: 1,
      items: [{ id: "hug", groupId: "custom", name: "微笑", keywords: [], text: "🙂" }],
    });

    const listbox = screen.getByRole("listbox", { name: "表情候选" });
    expect(listbox.style.left).not.toBe("");
    expect(listbox.style.top).not.toBe("");
    expect(screen.getByRole("option", { name: /微笑/ })).toBeInTheDocument();
    coords.mockRestore();
  });

  it("卸载时清空宿主回调，避免编辑器重建后收到陈旧状态", () => {
    const instance = createEditor();
    const { unmount } = render(<EmojiSuggestion editor={instance} />);
    const storage = (instance.storage as unknown as { emoji: EmojiStorage }).emoji;
    expect(storage.onTrigger).not.toBeNull();
    unmount();
    expect(storage.onTrigger).toBeNull();
  });
});
