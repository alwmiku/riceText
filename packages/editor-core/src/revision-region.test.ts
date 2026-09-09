import {
  Editor,
  Mark,
  Node as TiptapNode,
  type Extensions,
  type JSONContent,
  type MarkConfig,
  type NodeConfig,
} from "@tiptap/core";
import { chapterTextLines, chromeSurface } from "@ricetext/document-core";
import { afterEach, describe, expect, it } from "vitest";

import { schemaExtensions } from "./extensions/schema.js";
import { isRevisionSurfaceProse, resolveRevisionRegion } from "./revision-region.js";
import { applyRevisionSurfaces } from "./viewer/revision-surface.js";

const mounted: Array<{ editor: Editor; container: HTMLElement }> = [];

afterEach(() => {
  for (const { editor, container } of mounted.splice(0)) {
    editor.destroy();
    container.remove();
  }
});

function createReader(content: JSONContent, additionalExtensions: Extensions = []) {
  const container = document.createElement("div");
  container.className = "rt-viewer";
  document.body.append(container);
  const editor = new Editor({
    element: container,
    extensions: [...schemaExtensions(), ...additionalExtensions],
    content,
    editable: false,
  });
  mounted.push({ editor, container });
  applyRevisionSurfaces(editor);
  return { editor, viewer: editor.view.dom as HTMLElement };
}

/** 找到包含指定文本的第一个文本节点。 */
function textNode(viewer: Element, text: string): Node {
  const walker = document.createTreeWalker(viewer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.includes(text)) return node;
  }
  throw new Error(`未找到文本 ${text}`);
}

function rangeOf(node: Node, text: string): Range {
  const source = node.textContent ?? "";
  const start = source.indexOf(text);
  if (start < 0) throw new Error(`文本节点中未找到 ${text}`);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + text.length);
  return range;
}

function regionOf(viewer: Element, text: string, lines: readonly string[]) {
  const node = textNode(viewer, text);
  return resolveRevisionRegion({ viewer, range: rangeOf(node, text), lines });
}

const content: JSONContent = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "灯塔正好熄灭。" }] },
    {
      type: "pollRef",
      attrs: {
        pollId: "p1",
        question: "下一章先去哪里？",
        multiple: false,
        options: [{ id: "a", label: "钟楼" }],
      },
    },
    {
      type: "attachmentRef",
      attrs: {
        attachmentId: "f1",
        name: "附件名称.pdf",
        mimeType: "application/pdf",
        size: 2048,
        priceCoins: 8,
      },
    },
    {
      type: "richImage",
      attrs: {
        assetId: "a1",
        src: "/uploads/a.png",
        alt: "图片",
        caption: "图片说明文字",
        align: "center",
        width: 100,
      },
    },
    {
      type: "paragraph",
      content: [
        { type: "mention", attrs: { userId: "u1", name: "读者", resolved: true, avatarUrl: null } },
        { type: "text", text: " " },
        {
          type: "diceRoll",
          attrs: { rollId: "r1", expression: "2d6", rolls: [3, 4], total: 7, rerollOf: null },
        },
      ],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "黑幕文字", marks: [{ type: "spoiler" }] }],
    },
    {
      type: "novelExcerpt",
      attrs: {
        bookTitle: "Rice Book",
        chapterTitle: "第一章",
        author: "作者",
        sourceUrl: null,
        variant: "fanqie",
        readerTime: "",
        batteryLevel: 100,
        pageLabel: "1/1",
        progressLabel: "",
        headerLabel: "",
      },
      content: [{ type: "paragraph", content: [{ type: "text", text: "摘录里的正文" }] }],
    },
    {
      type: "longTextBlock",
      attrs: {
        chapterId: "c1",
        title: "长文标题",
        volumeTitle: "",
        text: "长文正文",
        order: 0,
        start: null,
        end: null,
      },
    },
  ],
};
const lines = chapterTextLines(content.content ?? []);

describe("resolveRevisionRegion", () => {
  it("正文选区给出文本、行号与行文本", () => {
    const { viewer } = createReader(content);
    expect(regionOf(viewer, "正好", lines)).toEqual({
      fromText: "正好",
      lineNo: 1,
      lineText: "灯塔正好熄灭。",
    });
  });

  it.each([
    ["投票标题", "下一章先去哪里？"],
    ["附件说明", "附件名称.pdf"],
    ["图片说明", "图片说明文字"],
    ["提及用户", "读者"],
    ["骰子结果", "2d6 = 7"],
  ])("属性派生的%s不可修订", (_name, text) => {
    const { viewer } = createReader(content);
    expect(regionOf(viewer, text, lines)).toBeNull();
  });

  it("摘录正文可修订，页眉页脚与书名不可修订", () => {
    const { viewer } = createReader(content);
    expect(regionOf(viewer, "摘录里的正文", lines)).toEqual({
      fromText: "摘录里的正文",
      lineNo: 7,
      lineText: "摘录里的正文",
    });
    for (const text of ["第一章", "1/1", "《Rice Book》"]) {
      expect(regionOf(viewer, text, lines), text).toBeNull();
    }
  });

  it("长文本块整块不可修订", () => {
    const { viewer } = createReader(content);
    expect(regionOf(viewer, "长文正文", lines)).toBeNull();
  });

  it("黑幕只在展开后提供修订", () => {
    const { viewer } = createReader(content);
    expect(regionOf(viewer, "黑幕文字", lines)).toBeNull();
    viewer.querySelector('[data-spoiler="true"]')!.setAttribute("aria-expanded", "true");
    expect(regionOf(viewer, "黑幕文字", lines)?.lineNo).toBe(6);
  });

  it("起点与终点都在正文、但跨过装饰组件的选区不可修订", () => {
    const { viewer } = createReader(content);
    const range = document.createRange();
    range.setStart(textNode(viewer, "灯塔正好熄灭"), 0);
    range.setEnd(textNode(viewer, "下一章先去哪里？"), 2);
    expect(resolveRevisionRegion({ viewer, range, lines })).toBeNull();
  });

  it("折叠选区、查看器之外的选区与空文本都返回 null", () => {
    const { viewer } = createReader(content);
    const collapsed = rangeOf(textNode(viewer, "灯塔正好熄灭"), "正好");
    collapsed.collapse(true);
    expect(resolveRevisionRegion({ viewer, range: collapsed, lines })).toBeNull();

    const outside = document.createElement("p");
    outside.textContent = "正文之外";
    document.body.append(outside);
    const outsideRange = document.createRange();
    outsideRange.selectNodeContents(outside);
    expect(resolveRevisionRegion({ viewer, range: outsideRange, lines })).toBeNull();
    outside.remove();
  });

  it("平台控件即使出现在正文里也不是正文", () => {
    const { viewer } = createReader(content);
    const button = document.createElement("button");
    button.textContent = "投票";
    viewer.querySelector("p")!.append(button);
    expect(regionOf(viewer, "投票", lines)).toBeNull();
    expect(isRevisionSurfaceProse(viewer, viewer)).toBe(true);
  });

  it("第三方扩展只靠声明能力参与，无需修改任何共享代码", () => {
    const Callout = TiptapNode.create({
      name: "callout",
      group: "block",
      content: "block+",
      capabilities: { revision: { surface: "prose" } },
      parseHTML: () => [{ tag: 'aside[data-callout="true"]' }],
      renderHTML: () => [
        "aside",
        { "data-callout": "true" },
        ["header", { class: "callout__title", ...chromeSurface() }, "提示标题"],
        ["div", { class: "callout__body" }, 0],
      ],
    } satisfies NodeConfig);
    const NoteMark = Mark.create({
      name: "noteMark",
      parseHTML: () => [{ tag: 'span[data-note="true"]' }],
      renderHTML: () => ["span", { "data-note": "true" }, 0],
      capabilities: { revision: { surface: "chrome", domSelector: '[data-note="true"]' } },
    } satisfies MarkConfig);

    const thirdParty: JSONContent = {
      type: "doc",
      content: [
        {
          type: "callout",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "提示正文" }] },
            {
              type: "paragraph",
              content: [{ type: "text", text: "标注文字", marks: [{ type: "noteMark" }] }],
            },
          ],
        },
      ],
    };
    const thirdPartyLines = chapterTextLines(thirdParty.content ?? []);
    const { viewer } = createReader(thirdParty, [Callout, NoteMark]);

    expect(viewer.querySelector('[data-callout="true"]')?.getAttribute("data-rt-revise")).toBe(
      "prose",
    );
    expect(regionOf(viewer, "提示标题", thirdPartyLines)).toBeNull();
    expect(regionOf(viewer, "标注文字", thirdPartyLines)).toBeNull();
    expect(regionOf(viewer, "提示正文", thirdPartyLines)).toEqual({
      fromText: "提示正文",
      lineNo: 1,
      lineText: "提示正文标注文字",
    });
  });
});
