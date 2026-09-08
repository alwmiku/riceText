import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { Editor, JSONContent } from "../packages/editor-core/src/index";

type EditorElement = HTMLElement & { editor: Editor };
const editorSelector = ".ProseMirror[contenteditable=true]";
const emptyDocument: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };
const replacementDocument: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "目标旧正文应被替换" }] }],
};

const text = (value: string, marks?: JSONContent["marks"]): JSONContent => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (content: JSONContent[], attrs?: JSONContent["attrs"]): JSONContent => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  content,
});

// 保留 schema 默认的 null/空属性；预期值来自源编辑器 JSON，不通过 HTML 再解析来生成。
// 摘录必须经过真实 React NodeView，装饰文字和翻页控件不得污染粘贴后的正文。
function richDocument(marker: string): JSONContent {
  return {
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
        content: [text(marker, [{ type: "bold" }])],
      },
      paragraph(
        [
          text("加粗斜体下划线", [{ type: "bold" }, { type: "italic" }, { type: "underline" }]),
          text(" 两个  空格、emoji 😊 与彩色字体", [
            {
              type: "textStyle",
              attrs: { color: "#197c73", fontFamily: "Noto Serif SC Variable", fontSize: "24px" },
            },
          ]),
          { type: "hardBreak" },
          text("删除线", [{ type: "strike" }]),
          text("行内代码", [{ type: "code" }]),
          text("黑幕文字", [{ type: "spoiler" }]),
          text("来源链接", [
            {
              type: "link",
              attrs: {
                href: "https://example.com/clipboard?from=rich&tab=2",
                target: "_blank",
                rel: "noopener noreferrer nofollow",
              },
            },
          ]),
          text("半透明颜色", [
            { type: "textStyle", attrs: { color: "#b6343480", fontFamily: null, fontSize: null } },
          ]),
        ],
        { textAlign: "justify", firstLineIndent: 4, leftIndent: 6 },
      ),
      paragraph([text("默认段落属性也必须完整往返")]),
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            attrs: { textAlign: "right" },
            content: [
              paragraph([text("无序列表首项", [{ type: "bold" }])], {
                textAlign: "right",
                firstLineIndent: 2,
                leftIndent: 2,
              }),
              {
                type: "orderedList",
                attrs: { start: 3, type: "a" },
                content: [{ type: "listItem", content: [paragraph([text("嵌套有序列表")])] }],
              },
            ],
          },
          { type: "listItem", content: [paragraph([text("无序列表次项")])] },
        ],
      },
      {
        type: "orderedList",
        attrs: { start: 7 },
        content: [{ type: "listItem", content: [paragraph([text("从七开始的列表")])] }],
      },
      {
        type: "blockquote",
        content: [
          paragraph([text("引用内的格式", [{ type: "italic" }])], {
            textAlign: "center",
            firstLineIndent: 2,
            leftIndent: 4,
          }),
        ],
      },
      {
        type: "codeBlock",
        attrs: { language: "javascript" },
        content: [text("const answer = 42;\n  console.log(answer);")],
      },
      { type: "codeBlock", attrs: { language: null }, content: [text("无语言代码块\n  保留缩进")] },
      { type: "horizontalRule" },
      paragraph([
        text("原子节点："),
        {
          type: "mention",
          attrs: { userId: null, name: "剪贴板访客", resolved: false, avatarUrl: null },
        },
        text(" 与 "),
        {
          type: "diceRoll",
          attrs: {
            rollId: "clipboard-roll",
            expression: "2d6",
            rolls: [2, 5],
            total: 7,
            rerollOf: null,
          },
        },
      ]),
      {
        type: "novelExcerpt",
        attrs: {
          bookTitle: "剪贴板里的星河",
          chapterTitle: "第二章 跨页重逢",
          author: "摘录作者",
          sourceUrl: "https://example.com/novel/2",
          readerTime: "12:34",
          batteryLevel: 62,
          pageLabel: "2/5",
          progressLabel: "40%",
          headerLabel: "自定义顶部信息",
          variant: "qidian",
        },
        content: [
          paragraph([text("摘录第一段保留格式", [{ type: "bold" }, { type: "underline" }])], {
            textAlign: "right",
            firstLineIndent: 2,
            leftIndent: 4,
          }),
          paragraph([text("摘录第二段 😊  仍可编辑")]),
        ],
      },
      paragraph([text("全文结束标记")]),
    ],
  };
}

async function createDraft(page: Page, label: string) {
  await page.goto("/compose");
  const previousId = await page.evaluate(() => localStorage.getItem("ricetext:selected-document"));
  await page.getByRole("button", { name: "新文章", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建文章", exact: true });
  await dialog.getByLabel("文章名称").fill(`剪贴板验收 ${label} ${randomUUID()}`);
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("ricetext:selected-document")))
    .not.toBe(previousId);
  const id = await page.evaluate(() => localStorage.getItem("ricetext:selected-document"));
  expect(id).toMatch(/^article_/);
  await page.getByRole("button", { name: "完整", exact: true }).click();
  const editor = page.locator(editorSelector);
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await expect(editor).toHaveText("");
  await expect
    .poll(() =>
      editor.evaluate((element) => Boolean((element as EditorElement).editor?.isInitialized)),
    )
    .toBe(true);
  return id;
}

async function createEditors(context: BrowserContext, source: Page) {
  // 同一浏览器上下文的两个真实标签页共用系统剪贴板，但各自编辑不同的本地草稿。
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const sourceId = await createDraft(source, "来源");
  const target = await context.newPage();
  const targetId = await createDraft(target, "目标");
  expect(targetId).not.toBe(sourceId);
  return target;
}

async function setContent(page: Page, content: JSONContent) {
  const expected = await page.locator(editorSelector).evaluate((element, fixture) => {
    const editor = (element as EditorElement).editor;
    // schema 校验同时防止 fixture 本身无效或字段在准备阶段被静默丢弃。
    const document = editor.schema.nodeFromJSON(fixture);
    document.check();
    if (!editor.commands.setContent(fixture, { errorOnInvalidContent: true })) {
      throw new Error("无法为真实编辑器设置剪贴板测试正文");
    }
    return document.toJSON() as JSONContent;
  }, content);
  await expect.poll(() => getJSON(page)).toEqual(expected);
  return expected;
}

function getJSON(page: Page) {
  return page
    .locator(editorSelector)
    .evaluate((element) => (element as EditorElement).editor.getJSON());
}

async function select(page: Page, range: "all" | { from: number; to: number }) {
  await page.bringToFront();
  await page.locator(editorSelector).locator(":scope > :first-child").scrollIntoViewIfNeeded();
  await page.locator(editorSelector).evaluate((element, selection) => {
    const editor = (element as EditorElement).editor;
    if (selection === "all") editor.commands.selectAll();
    else editor.commands.setTextSelection(selection);
    editor.view.focus();
  }, range);
  await expect(page.locator(editorSelector)).toBeFocused();
}

function floatingToolbar(page: Page) {
  return page.getByRole("toolbar", { name: /^选区(?:浮动工具栏|格式菜单)$/ });
}

async function readClipboard(page: Page) {
  return page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find(
      (value) => value.types.includes("text/html") && value.types.includes("text/plain"),
    );
    return {
      types: items.flatMap((value) => [...value.types]),
      html: item ? await (await item.getType("text/html")).text() : "",
      plain: item ? await (await item.getType("text/plain")).text() : "",
    };
  });
}

async function copyWithToolbar(page: Page, selectedText: string) {
  const toolbar = floatingToolbar(page);
  await expect(toolbar).toBeVisible();
  // 写入真实剪贴板哨兵，避免连续复制相同文字时误读上一次的闭合/开放切片。
  await page.evaluate(
    (sentinel) => navigator.clipboard.writeText(sentinel),
    `等待真实复制 ${randomUUID()}`,
  );
  await toolbar.getByRole("button", { name: "复制", exact: true }).click();
  // 等待真正的异步剪贴板写入；不 mock navigator.clipboard，也不模拟 ClipboardEvent。
  await expect.poll(async () => (await readClipboard(page)).plain).toContain(selectedText);
  const clipboard = await readClipboard(page);
  expect(clipboard.types).toEqual(expect.arrayContaining(["text/html", "text/plain"]));
  expect(clipboard.html).toContain("data-pm-slice");
  return clipboard;
}

async function pasteWithKeyboard(
  page: Page,
  selection: "all" | { from: number; to: number } = "all",
) {
  await select(page, selection);
  await page.keyboard.press("Control+v");
}

test.describe("真实跨标签页富文本剪贴板", () => {
  test.beforeEach(async ({ isMobile }) => {
    test.skip(isMobile, "本组验证桌面浮动工具栏及原生 Ctrl+V，移动端不重复写共享草稿");
  });
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("整篇复制到另一页：Ctrl+V 与浮动粘贴按钮均保留全部富文本和自定义摘录", async ({
    context,
    page,
  }) => {
    const target = await createEditors(context, page);
    const marker = `完整剪贴板正文 ${randomUUID()}`;
    const expected = await setContent(page, richDocument(marker));
    await setContent(target, replacementDocument);
    await select(page, "all");
    const clipboard = await copyWithToolbar(page, marker);
    for (const selectedText of [
      "两个  空格、emoji 😊",
      "@剪贴板访客",
      "2d6 = 7",
      "摘录第二段 😊  仍可编辑",
      "全文结束标记",
    ]) {
      expect(clipboard.plain).toContain(selectedText);
    }
    expect(clipboard.html).toContain("novel-excerpt");
    expect(clipboard.html).toContain("data-chapter-start");

    await test.step("目标全选后原生 Ctrl+V，完整 JSON 与源文档相等", async () => {
      await pasteWithKeyboard(target);
      await expect.poll(() => getJSON(target)).toEqual(expected);
    });
    await test.step("重新点击复制，再点击目标浮动工具栏的粘贴按钮", async () => {
      await setContent(target, replacementDocument);
      await select(page, "all");
      await copyWithToolbar(page, marker);
      await select(target, "all");
      const toolbar = floatingToolbar(target);
      await expect(toolbar).toBeVisible();
      await toolbar.getByRole("button", { name: "粘贴", exact: true }).click();
      await expect.poll(() => getJSON(target)).toEqual(expected);
    });
    await expect.poll(() => getJSON(page)).toEqual(expected);
  });

  test("部分混合标记选区只复制选中文字，保留交叠标记、emoji 和空格", async ({ context, page }) => {
    const target = await createEditors(context, page);
    const prefix = "不应复制的前文";
    const bold = "舍弃粗体";
    const mixed = "混合😊  空格";
    const italic = "斜体舍弃";
    const source = await setContent(page, {
      type: "doc",
      content: [
        paragraph([
          text(prefix),
          text(bold, [{ type: "bold" }]),
          text(mixed, [
            { type: "bold" },
            { type: "italic" },
            { type: "underline" },
            {
              type: "textStyle",
              attrs: { color: "#6b4bb5", fontSize: "20px", fontFamily: "monospace" },
            },
          ]),
          text(italic, [{ type: "italic" }]),
          text("不应复制的后文"),
        ]),
      ],
    });
    await setContent(target, emptyDocument);
    await select(page, {
      from: 1 + prefix.length + "舍弃".length,
      to: 1 + prefix.length + bold.length + mixed.length + "斜体".length,
    });
    const selectedText = `粗体${mixed}斜体`;
    const clipboard = await copyWithToolbar(page, selectedText);
    expect(clipboard.plain).toBe(selectedText);
    for (const omitted of [prefix, "不应复制的后文", "舍弃"]) {
      expect(clipboard.html).not.toContain(omitted);
    }
    const sourceParagraph = source.content![0]!;
    const nodes = sourceParagraph.content!;
    const expected: JSONContent = {
      type: "doc",
      content: [
        {
          ...sourceParagraph,
          content: [{ ...nodes[1]!, text: "粗体" }, nodes[2]!, { ...nodes[3]!, text: "斜体" }],
        },
      ],
    };
    await pasteWithKeyboard(target);
    await expect.poll(() => getJSON(target)).toEqual(expected);
    await expect.poll(() => getJSON(page)).toEqual(source);
  });

  test("单段对齐和缩进复制到空白段落保留，插入已有正文时遵循段落合并", async ({
    context,
    page,
  }) => {
    const target = await createEditors(context, page);
    const body = "居右缩进的单段 😊  双空格";
    const source = await setContent(page, {
      type: "doc",
      content: [
        paragraph(
          [
            text(body, [
              { type: "bold" },
              {
                type: "textStyle",
                attrs: { color: "#197c73", fontSize: "18px", fontFamily: "sans-serif" },
              },
            ]),
          ],
          { textAlign: "right", firstLineIndent: 4, leftIndent: 6 },
        ),
      ],
    });
    await test.step("选择整个段落节点并替换空白文档，保留块属性", async () => {
      await setContent(target, emptyDocument);
      await select(page, "all");
      await copyWithToolbar(page, body);
      await pasteWithKeyboard(target);
      await expect.poll(() => getJSON(target)).toEqual(source);
    });
    await test.step("仅选段落文字再粘贴到空段落光标，仍保留对齐和缩进", async () => {
      await setContent(target, emptyDocument);
      await select(page, { from: 1, to: body.length + 1 });
      await copyWithToolbar(page, body);
      await pasteWithKeyboard(target, { from: 1, to: 1 });
      await expect.poll(() => getJSON(target)).toEqual(source);
    });
    await test.step("同一文本切片插入已有段落时保留目标段落属性和未选文字", async () => {
      const before = "原有前文";
      const after = "原有后文";
      const targetBefore = await setContent(target, {
        type: "doc",
        content: [
          paragraph([text(before + after)], {
            textAlign: "left",
            firstLineIndent: 2,
            leftIndent: 2,
          }),
        ],
      });
      await pasteWithKeyboard(target, { from: before.length + 1, to: before.length + 1 });
      const expected: JSONContent = {
        ...targetBefore,
        content: [
          {
            ...targetBefore.content![0]!,
            content: [text(before), ...source.content![0]!.content!, text(after)],
          },
        ],
      };
      await expect.poll(() => getJSON(target)).toEqual(expected);
    });
    await expect.poll(() => getJSON(page)).toEqual(source);
  });
});

test("移动端浮动工具栏跨标签页复制粘贴保留完整格式", async ({ context, page, isMobile }) => {
  test.skip(!isMobile, "本例覆盖移动端浮动菜单");
  test.setTimeout(60_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  context.on("page", (opened) => {
    opened.on("pageerror", (error) => pageErrors.push(error.message));
  });
  const target = await createEditors(context, page);
  for (const editorPage of [page, target]) {
    await editorPage.bringToFront();
    await editorPage.getByRole("button", { name: "移动", exact: true }).tap();
  }
  const marker = `手机剪贴板 ${randomUUID()}`;
  const expected = await setContent(page, richDocument(marker));
  await setContent(target, replacementDocument);
  await select(page, "all");
  // 触摸真实复制按钮，并以系统剪贴板哨兵防止读取旧内容。
  await page.evaluate(
    (sentinel) => navigator.clipboard.writeText(sentinel),
    `等待真实复制 ${randomUUID()}`,
  );
  await floatingToolbar(page).getByRole("button", { name: "复制", exact: true }).tap();
  await expect.poll(async () => (await readClipboard(page)).plain).toContain(marker);
  const clipboard = await readClipboard(page);
  expect(clipboard.types).toEqual(expect.arrayContaining(["text/html", "text/plain"]));
  expect(clipboard.html).toContain("data-pm-slice");
  expect(clipboard.html).toContain("novel-excerpt");
  expect(clipboard.plain).toContain("摘录第二段 😊  仍可编辑");
  expect(clipboard.plain).toContain("全文结束标记");
  await select(target, "all");
  await floatingToolbar(target).getByRole("button", { name: "粘贴", exact: true }).tap();
  await expect.poll(() => getJSON(target)).toEqual(expected);
  await expect.poll(() => getJSON(page)).toEqual(expected);
  await test.step("粘贴后的摘录仍可输入、换段和撤销", async () => {
    const position = await target.locator(editorSelector).evaluate((element) => {
      const editor = (element as EditorElement).editor;
      let from = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "novelExcerpt") {
          from = pos + 2 + node.child(0).nodeSize;
          return false;
        }
      });
      return from;
    });
    expect(position).toBeGreaterThan(0);
    await select(target, { from: position, to: position });
    const inserted = "手机实际输入";
    await target.keyboard.insertText(inserted);
    const afterTyping = structuredClone(expected);
    const excerpt = afterTyping.content!.find((node) => node.type === "novelExcerpt")!;
    excerpt.content![1]!.content![0]!.text = inserted + excerpt.content![1]!.content![0]!.text;
    await expect.poll(() => getJSON(target)).toEqual(afterTyping);
    await target.keyboard.press("Enter");
    const afterEnter = structuredClone(expected);
    const splitExcerpt = afterEnter.content!.find((node) => node.type === "novelExcerpt")!;
    splitExcerpt.content!.splice(1, 0, {
      ...structuredClone(splitExcerpt.content![1]!),
      content: [text(inserted)],
    });
    await expect.poll(() => getJSON(target)).toEqual(afterEnter);
    await target.keyboard.press("Control+z");
    await expect.poll(() => getJSON(target)).toEqual(expected);
  });
  expect(pageErrors).toEqual([]);
});
