import { expect, test, type Page } from "@playwright/test";

async function prepare(page: Page, mobile: boolean) {
  await page.goto("/compose");
  const editor = page.locator(".ProseMirror[contenteditable=true]");
  await expect(editor).toBeVisible({ timeout: 20_000 });
  if (!mobile) await page.getByRole("button", { name: /完整/ }).click();
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("source");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("target");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("third");
  await expect(editor.getByText("target", { exact: true })).toBeVisible();
  await expect(editor.getByText("third", { exact: true })).toBeVisible();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Control+b");
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
  await expect(
    page.getByText("正文已保存，可切换到阅读视图检查", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
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
  // Native selection can be adjusted without triggering the desktop pointer handler.
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
  await expect(
    page.getByRole("button", { name: "增加整段缩进", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-narrow.png") });
});
