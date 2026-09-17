/*
 * 覆盖层 PluginView 的行为约束：
 * - 必须挂在受 ProseMirror 管理的 textblock widget 内，而不是正文之外的全局兄弟节点，
 *   否则分页 transform 与不透明背景会盖住黑带；
 * - 测量不到矩形（jsdom 没有布局）时必须安全空转；
 * - ResizeObserver 不能因为重复 observe 形成渲染循环。
 */
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorExtensions } from "./editor.js";

const mounted: HTMLElement[] = [];

/** 等待一帧渲染：实现走 rAF，这里用宏任务超时即可覆盖。 */
function frame(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 40));
}

function domRect(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** jsdom 不做真实布局，直接给内层 span 规定 getClientRects() 的返回值。 */
function setClientRect(element: HTMLElement, value: DOMRect): void {
  Object.defineProperty(element, "getClientRects", {
    configurable: true,
    value: () => [value],
  });
}

function createSpoilerEditor(): { editor: Editor; host: HTMLElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  mounted.push(host);
  const editor = new Editor({
    element: host,
    extensions: createEditorExtensions(),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "小", marks: [{ type: "spoiler" }] },
            {
              type: "text",
              text: "大",
              marks: [{ type: "spoiler" }, { type: "textStyle", attrs: { fontSize: "32px" } }],
            },
            { type: "text", text: "小", marks: [{ type: "spoiler" }] },
          ],
        },
      ],
    },
  });
  return { editor, host };
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const element of mounted.splice(0)) element.remove();
});

describe("SpoilerOverlay PluginView", () => {
  it("renders fixed-radius pieces inside a managed textblock widget", async () => {
    const { editor } = createSpoilerEditor();
    const inks = Array.from(editor.view.dom.querySelectorAll<HTMLElement>(".rt-spoiler__ink"));
    expect(inks).toHaveLength(3);
    setClientRect(inks[0]!, domRect(0, 10, 20, 30));
    setClientRect(inks[1]!, domRect(20, 0, 50, 34));
    setClientRect(inks[2]!, domRect(50, 10, 70, 30));

    window.dispatchEvent(new Event("resize"));
    await frame();

    const overlay = editor.view.dom.querySelector<HTMLElement>("[data-rt-spoiler-overlay]");
    expect(overlay).not.toBeNull();
    expect(overlay?.parentElement?.tagName).toBe("P");
    expect(overlay?.parentElement).toHaveClass("rt-spoiler-overlay-block-host");
    expect(overlay).toHaveAttribute("contenteditable", "false");
    expect(overlay).toHaveAttribute("aria-hidden", "true");

    const fills = overlay!.querySelectorAll<HTMLElement>('[data-rt-spoiler-piece="fill"]');
    const cutouts = overlay!.querySelectorAll<HTMLElement>('[data-rt-spoiler-piece="cutout"]');
    expect(fills.length).toBeGreaterThan(0);
    expect(cutouts).toHaveLength(2);
    for (const piece of Array.from(overlay!.children) as HTMLElement[]) {
      for (const value of [
        piece.style.borderTopLeftRadius,
        piece.style.borderTopRightRadius,
        piece.style.borderBottomRightRadius,
        piece.style.borderBottomLeftRadius,
      ]) {
        expect(["0px", "3px"]).toContain(value);
      }
    }

    editor.destroy();
    expect(overlay?.children).toHaveLength(0);
  });

  it("keeps an empty widget safe when layout APIs return no rectangles", async () => {
    const { editor } = createSpoilerEditor();
    await frame();
    const overlay = editor.view.dom.querySelector<HTMLElement>("[data-rt-spoiler-overlay]");
    expect(overlay).not.toBeNull();
    expect(overlay?.children).toHaveLength(0);
    editor.destroy();
  });

  // 观察器实现记录 observe 调用次数：若每次渲染都重新 observe，每次 observe 又会立刻
  // 投递一次初始回调，就会变成永不停歇的渲染循环。
  it("keeps ResizeObserver subscriptions stable across callbacks", async () => {
    const instances: TestResizeObserver[] = [];
    class TestResizeObserver implements ResizeObserver {
      readonly observed = new Set<Element>();
      observeCalls = 0;
      constructor(readonly callback: ResizeObserverCallback) {
        instances.push(this);
      }
      observe(target: Element) {
        this.observeCalls += 1;
        this.observed.add(target);
      }
      unobserve(target: Element) {
        this.observed.delete(target);
      }
      disconnect() {
        this.observed.clear();
      }
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);

    const { editor } = createSpoilerEditor();
    await frame();
    const observer = instances[0]!;
    const initialCalls = observer.observeCalls;
    expect(initialCalls).toBeGreaterThan(0);

    observer.callback([], observer);
    await frame();
    expect(observer.observeCalls).toBe(initialCalls);

    editor.destroy();
    expect(observer.observed.size).toBe(0);
  });
});
