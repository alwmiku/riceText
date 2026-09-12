import { expect, test } from "@playwright/test";

/**
 * 表情功能回归：
 * 1. 工具栏面板：搜索 → 插入 → 正文真的出现从 /api/emoji 加载成功的图片；
 * 2. 输入触发：敲 hh 弹出候选，回车插入并吃掉前缀；
 * 3. 移动端：折叠菜单里的表情面板可用且不撑破视口；
 * 4. 只读阅读器同样渲染已持久化的表情节点。
 */
test("桌面：工具栏表情面板插入自定义表情并把图片渲染出来", async ({ page, isMobile }) => {
  test.skip(isMobile, "仅桌面");
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/compose");
  await page.getByRole("button", { name: /完整/ }).click();
  await expect(page.getByRole("toolbar", { name: "富文本工具栏" })).toBeVisible();

  await page.getByRole("button", { name: "表情", exact: true }).click();
  await expect(page.getByRole("group", { name: "表情选择器" })).toBeVisible();

  await page.getByLabel("搜索表情").fill("hh");
  // 必须限定在表情列表里：工具栏的字号/字体 <select> 也会暴露 role=option。
  const picker = page.getByRole("listbox", { name: "表情列表" });
  const firstOption = picker.getByRole("option").first();
  await expect(firstOption).toHaveAttribute("aria-label", "害羞");
  await firstOption.click();

  const inserted = page.locator('.ProseMirror [data-node-type="emoji"]').first();
  await expect(inserted).toBeVisible();
  await expect(inserted).toHaveAttribute("data-emoji-id", "shy-sticker");

  // 图片必须真的加载成功：naturalWidth > 0 说明表情包动图真的从 API 取到了。
  const image = inserted.locator("img");
  await expect(image).toHaveAttribute("src", "/api/emoji/shy-sticker/image");
  await expect
    .poll(async () => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
});

test("桌面：输入 hh 弹出候选浮层，回车插入并吃掉前缀", async ({ page, isMobile }) => {
  test.skip(isMobile, "仅桌面");
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/compose");
  await page.getByRole("button", { name: /完整/ }).click();
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type("hh", { delay: 60 });

  const listbox = page.getByRole("listbox", { name: "表情候选" });
  await expect(listbox).toBeVisible();
  // 同样限定在浮层内，避免命中工具栏 select 的 option。
  await expect(listbox.getByRole("option").first()).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(listbox).toBeHidden();
  // 前缀被完全替换：正文里不应残留 "hh" 这两个字符。
  await expect(editor).not.toContainText("hh");
});

test("移动端：折叠菜单里的表情面板可用且不产生水平溢出", async ({ page, isMobile }) => {
  test.skip(!isMobile, "仅移动端");
  await page.goto("/compose");
  await page.getByRole("button", { name: "移动" }).click();
  await page.getByRole("button", { name: "插入内容" }).click();
  await page.getByRole("menuitem", { name: "表情" }).click();
  await expect(page.getByRole("group", { name: "表情选择器" })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("只读阅读器渲染表情节点且没有编辑入口", async ({ page }) => {
  await page.goto("/read");
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);

  // 演示正文是否包含表情取决于已有数据目录；这里断言的是「一旦出现就必须是
  // 由 /api/emoji 提供的图片」，而不是外链或空白。
  const emoji = page.locator('.rt-viewer [data-node-type="emoji"]');
  const count = await emoji.count();
  if (count === 0)
    test
      .info()
      .annotations.push({ type: "note", description: "当前数据目录的演示正文没有表情节点" });
  for (let index = 0; index < count; index += 1) {
    await expect(emoji.nth(index).locator("img")).toHaveAttribute(
      "src",
      /\/api\/emoji\/[a-z0-9-]+\/image$/u,
    );
  }
});
