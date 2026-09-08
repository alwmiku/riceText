import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function prepare(page: Page, mobile: boolean) {
  await page.goto("/compose");
  // 不覆盖默认文章：前序用例可能留下摘录、列表或带保护锚点的正文。
  const previousId = await page.evaluate(() => localStorage.getItem("ricetext:selected-document"));
  await page.getByRole("button", { name: "新文章", exact: true }).click();
  const create = page.getByRole("dialog", { name: "新建文章", exact: true });
  await create.getByLabel("文章名称").fill("Formatting " + randomUUID());
  await create.getByRole("button", { name: "创建", exact: true }).click();
  await expect(create).not.toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("ricetext:selected-document")))
    .not.toBe(previousId);
  const documentId = await page.evaluate(() => localStorage.getItem("ricetext:selected-document"));
  expect(documentId).toMatch(/^article_/);
  const editor = page.locator(".ProseMirror[contenteditable=true]");
  await expect(editor).toBeVisible({ timeout: 20_000 });
  if (!mobile) await page.getByRole("button", { name: /完整/ }).click();
  await expect(editor).toHaveText("");
  await expect(editor.locator(":scope > p")).toHaveCount(1);
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("source");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("target");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("third");
  await expect(editor.locator(":scope > p")).toHaveText(["source", "target", "third"]);
  const selectionToolbar = page.getByRole("toolbar", {
    name: mobile ? "选区格式菜单" : "选区浮动工具栏",
    exact: true,
  });
  await expect(editor).toBeFocused();
  await expect(selectionToolbar).toHaveCount(0);
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Shift+End");
  // 快捷键返回时 selectionchange 可能尚未处理；同时等待原生选区和编辑器选区状态。
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toBe("source");
  await expect(selectionToolbar).toBeVisible();
  await page.keyboard.press("Control+b");
  await expect(editor.locator(":scope > p").first().locator("strong")).toHaveText("source");
  return editor;
}

async function dragText(page: Page, text: string) {
  const paragraph = page
    .locator(".ProseMirror p")
    .filter({ hasText: new RegExp(`^${text}$`, "u") });
  await paragraph.scrollIntoViewIfNeeded();
  const box = await paragraph.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.mouse.move(box.x, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width, box.y + box.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
}

test("desktop selection toolbar hides while selecting or scrolling and returns afterwards", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile);
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto("/compose");
  await page.getByRole("button", { name: "新文章", exact: true }).click();
  const create = page.getByRole("dialog", { name: "新建文章", exact: true });
  await create.getByLabel("文章名称").fill("FloatingToolbar " + randomUUID());
  await create.getByRole("button", { name: "创建", exact: true }).click();
  await expect(create).not.toBeVisible();
  const editor = page.locator(".ProseMirror[contenteditable=true]");
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /完整/ }).click();
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("第1段正文内容用于浮动工具栏验收。");
  for (let index = 2; index <= 24; index += 1) {
    await page.keyboard.press("Enter");
    await page.keyboard.insertText(`第${index}段正文内容用于浮动工具栏验收。`);
  }
  const toolbar = page.getByRole("toolbar", { name: "选区浮动工具栏", exact: true });
  const gap = () =>
    page.evaluate(() => {
      const bar = document.querySelector(
        '[role="toolbar"][aria-label="选区浮动工具栏"]',
      ) as HTMLElement | null;
      const rect = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
      return {
        toolbarBottom: bar?.getBoundingClientRect().bottom ?? Number.NaN,
        selectionTop: rect?.top ?? Number.NaN,
      };
    });
  const attached = async () => {
    const current = await gap();
    expect(Math.abs(current.toolbarBottom - (current.selectionTop - 8))).toBeLessThanOrEqual(2);
  };

  // 先键盘选中最后一段，确认工具栏出现且贴在选区上方。
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Shift+Home");
  await expect(toolbar).toBeVisible();
  await attached();

  // 拖选其他段落：按住鼠标期间隐藏，松开并停顿后显示。
  const target = editor.locator(":scope > p").nth(4);
  await target.scrollIntoViewIfNeeded();
  await expect(toolbar).toBeVisible();
  const box = await target.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 10 });
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).not.toBe("");
  await expect(toolbar).toBeHidden();
  await page.mouse.up();
  await expect(toolbar).toBeVisible();
  await attached();

  // 滚动过程中不显示，停下来后按最新选区重新显示。
  await page.evaluate(() => {
    const state = window as unknown as { __scrollTimer?: number };
    state.__scrollTimer = window.setInterval(() => window.scrollBy(0, 24), 40);
  });
  await expect(toolbar).toBeHidden();
  await page.evaluate(() => {
    const state = window as unknown as { __scrollTimer?: number };
    window.clearInterval(state.__scrollTimer);
  });
  await expect(toolbar).toBeVisible();
  await attached();
});

test("desktop painter double-click, repeated drag, undo and indentation", async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(isMobile);
  await page.setViewportSize({ width: 1920, height: 1000 });
  const editor = await prepare(page, false);
  await page.getByRole("button", { name: "格式刷", exact: true }).dblclick();
  await expect(editor).toHaveAttribute("data-format-painter", "continuous");
  await dragText(page, "target");
  await expect(
    editor
      .locator("p")
      .filter({ hasText: /^target$/u })
      .locator("strong"),
  ).toHaveText("target");
  await dragText(page, "third");
  await expect(
    editor
      .locator("p")
      .filter({ hasText: /^third$/u })
      .locator("strong"),
  ).toHaveText("third");
  await page.keyboard.press("Escape");
  await expect(editor).toHaveAttribute("data-format-painter", "off");
  await page.keyboard.press("Control+z");
  await expect(
    editor
      .locator("p")
      .filter({ hasText: /^third$/u })
      .locator("strong"),
  ).toHaveCount(0);
  await expect(
    editor
      .locator("p")
      .filter({ hasText: /^target$/u })
      .locator("strong"),
  ).toHaveText("target");
  await page.getByRole("button", { name: "缩进设置", exact: true }).click();
  await page.getByRole("button", { name: "增加首行缩进", exact: true }).click();
  await page.getByRole("checkbox", { name: "应用到全文" }).check();
  await page.getByRole("button", { name: "增加整段缩进", exact: true }).click();
  await expect(editor.locator("p").filter({ hasText: /^third$/u })).toHaveCSS(
    "text-indent",
    /[1-9][0-9]*px/u,
  );
  for (const p of await editor.locator("p").all())
    await expect(p).toHaveCSS("margin-left", /[1-9][0-9]*px/u);
  await page.screenshot({ path: testInfo.outputPath("desktop-indent.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("正文已保存，可切换到阅读视图检查", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.reload();
  await expect(editor.locator("p").filter({ hasText: /^third$/u })).toHaveCSS(
    "text-indent",
    /[1-9][0-9]*px/u,
  );
  await expect(editor.locator("p").filter({ hasText: /^target$/u })).toHaveCSS(
    "margin-left",
    /[1-9][0-9]*px/u,
  );
  await expect(
    editor
      .locator("p")
      .filter({ hasText: /^target$/u })
      .locator("strong"),
  ).toHaveText("target");
});

test("mobile explicit painter application and compact indentation", async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(!isMobile);
  const editor = await prepare(page, true);
  const textMenu = page.getByRole("button", { name: "文字格式", exact: true });
  await textMenu.tap();
  await page.getByRole("menuitem", { name: "格式刷", exact: true }).click();
  await page.getByRole("menuitem", { name: "连续格式刷", exact: true }).click();
  await expect(editor).toHaveAttribute("data-format-painter", "continuous");
  await editor
    .locator("p")
    .filter({ hasText: /^target$/u })
    .tap();
  await page.keyboard.press("Home");
  // 调整原生选区时，不应触发桌面端的指针处理逻辑。
  await page.keyboard.down("Shift");
  await page.keyboard.press("End");
  await textMenu.tap();
  await page.keyboard.up("Shift");
  await page.getByRole("menuitem", { name: "格式刷", exact: true }).click();
  await page.getByRole("menuitem", { name: "应用格式", exact: true }).click();
  await expect(
    editor
      .locator("p")
      .filter({ hasText: /^target$/u })
      .locator("strong"),
  ).toHaveText("target");
  await page.getByRole("button", { name: "段落排版", exact: true }).tap();
  await page.getByRole("checkbox", { name: "应用到全文" }).check();
  await page.getByRole("button", { name: "增加首行缩进", exact: true }).tap();
  await page.getByRole("button", { name: "增加整段缩进", exact: true }).tap();
  for (const p of await editor.locator("p").all()) {
    await expect(p).toHaveCSS("text-indent", /[1-9][0-9]*px/u);
    await expect(p).toHaveCSS("margin-left", /[1-9][0-9]*px/u);
  }
  await page.screenshot({ path: testInfo.outputPath("mobile-indent.png") });
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(page.getByRole("button", { name: "增加整段缩进", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-narrow.png") });
});
