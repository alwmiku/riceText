import { expect, test } from "@playwright/test";

/**
 * 拾色器交互回归：
 * 1. 桌面：有选区时选区浮动工具栏（z-60）不得遮挡拾色器 Popover（z-[70]）。
 * 2. 移动端：底部「文字格式」菜单限高滚动，紧凑拾色器可交互。
 */
test("桌面：选区存在时拾色器可调色并应用", async ({ page, isMobile }) => {
  test.skip(isMobile, "仅桌面");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/compose");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  await page.getByRole("button", { name: /完整/ }).click();
  await expect(page.getByRole("toolbar", { name: "富文本工具栏" })).toBeVisible();

  await editor.click();
  await page.keyboard.press("Control+a");
  await expect(page.getByRole("toolbar", { name: "选区浮动工具栏" })).toBeVisible();

  // 箭头按钮打开面板；色块按钮显示当前色并可直接应用。
  const arrowButton = page.getByRole("button", { name: "文字颜色", exact: true });
  const swatchButton = page.getByRole("button", { name: "应用文字颜色", exact: true });
  const swatchBg = () =>
    swatchButton.locator("span").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  const open = async () => {
    await arrowButton.click();
    await expect(page.getByLabel("拾色器")).toBeVisible();
  };

  // 1. 色块按钮点击：直接应用当前色（记忆色 #20272c），不打开面板
  await swatchButton.click();
  await expect(page.getByLabel("拾色器")).not.toBeVisible();
  await expect(editor.locator('[style*="color"]').first()).toBeVisible();

  // 2. 调色区（SV + 色相 + 透明度）为草稿：色块实时跟随，不应用到文字
  await open();
  const sv = page.getByRole("slider", { name: "饱和度与亮度" });
  const svBox = await sv.boundingBox();
  if (!svBox) throw new Error("SV 面板不可见");
  await page.mouse.click(svBox.x + svBox.width / 2, svBox.y + svBox.height / 2);
  const hue = page.getByRole("slider", { name: "色相" });
  const hueBox = await hue.boundingBox();
  if (!hueBox) throw new Error("色相滑杆不可见");
  await page.mouse.move(hueBox.x + hueBox.width * 0.5, hueBox.y + hueBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(hueBox.x + hueBox.width * 0.8, hueBox.y + hueBox.height / 2, { steps: 3 });
  await page.mouse.up();
  const sliderRoot = page.locator("[data-slot=slider]").first();
  const rootBox = await sliderRoot.boundingBox();
  if (!rootBox) throw new Error("透明度滑杆不可见");
  await page.mouse.click(rootBox.x + rootBox.width * 0.4, rootBox.y + rootBox.height / 2);
  // 色块跟随草稿变化（未应用）
  await expect.poll(swatchBg).not.toBe("rgb(32, 39, 44)");
  // 面板仍打开
  await expect(page.getByLabel("拾色器")).toBeVisible();

  // 3. 点色块按钮应用草稿色 → 面板关闭
  await swatchButton.click();
  await expect(page.getByLabel("拾色器")).not.toBeVisible();

  // 4. 已存色块 = 面板内直接应用
  await open();
  await page.getByLabel("文字颜色 #197c73", { exact: true }).click();
  await expect.poll(swatchBg).toBe("rgb(25, 124, 115)");
  await expect(page.getByLabel("拾色器")).not.toBeVisible();

  // 5. 记忆色：重新打开后草稿显示上次应用的颜色（#197c73）
  await open();
  await expect(page.getByLabel("Hex 色值")).toHaveValue("#197c73");
});


test("移动端：文字格式折叠组内紧凑拾色器可交互", async ({ page, isMobile }) => {
  test.skip(!isMobile, "仅移动端");
  await page.goto("/compose");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("Control+a");
  await expect(page.getByRole("toolbar", { name: "选区格式菜单" })).toBeVisible();

  // 文字格式菜单：一级菜单为格式项 + 字体/字号/颜色子菜单，不直接平铺
  await page.getByRole("button", { name: "文字格式" }).tap();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /字体/ })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /字号/ })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /文字颜色/ })).toBeVisible();
  await expect(menu.getByLabel("Hex 色值")).not.toBeVisible();

  // 文字颜色菜单项带色块：色块可单独点击直接应用（记忆色）
  await menu.getByRole("button", { name: "应用文字颜色" }).tap();
  await expect(editor.locator('[style*="color"]').first()).toBeVisible();

  // 右侧箭头展开完整选色面板（含 SV 矩形 + 透明度 + Hex + 已存色块）
  await menu.getByRole("menuitem", { name: /文字颜色/ }).tap();
  const subMenu = page.getByRole("menu").last();
  await expect(subMenu).toBeVisible();
  await expect(subMenu.getByRole("slider", { name: "饱和度与亮度" })).toBeVisible();
  await expect(subMenu.getByRole("slider", { name: "透明度" })).toBeVisible();
  await expect(subMenu.getByLabel("Hex 色值")).toBeVisible();
  await subMenu.getByLabel("文字颜色 #197c73", { exact: true }).tap();
  await expect(editor.locator('[style*="color"]').first()).toBeVisible();
});
/** 3. 桌面无选区：setColor 聚焦编辑器不应关闭拾色器（focusin 拦截）。 */
test("桌面：无选区时滑杆拖动生效且 popover 保持打开", async ({ page, isMobile }) => {
  test.skip(isMobile, "仅桌面");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/compose");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  await page.getByRole("button", { name: /完整/ }).click();
  await expect(page.getByRole("toolbar", { name: "富文本工具栏" })).toBeVisible();
  await editor.click();
  const arrowButton = page.getByRole("button", { name: "文字颜色", exact: true });
  const swatchButton = page.getByRole("button", { name: "应用文字颜色", exact: true });
  const swatchBg = () =>
    swatchButton.locator("span").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  await arrowButton.click();
  await expect(page.getByLabel("拾色器")).toBeVisible();

  // 色相滑杆真实拖动（草稿，不应用）
  const hue = page.getByRole("slider", { name: "色相" });
  const hueBox = await hue.boundingBox();
  if (!hueBox) throw new Error("色相滑杆不可见");
  await page.mouse.move(hueBox.x + hueBox.width / 2, hueBox.y + hueBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(hueBox.x + hueBox.width * 0.9, hueBox.y + hueBox.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByLabel("拾色器")).toBeVisible();

  // 透明度滑杆轨道点击（草稿，不应用）
  const sliderRoot = page.locator("[data-slot=slider]").first();
  const rootBox = await sliderRoot.boundingBox();
  if (!rootBox) throw new Error("透明度滑杆不可见");
  await page.mouse.click(rootBox.x + rootBox.width * 0.3, rootBox.y + rootBox.height / 2);
  await expect(page.getByLabel("拾色器")).toBeVisible();

  // 点色块按钮 → 应用草稿、色块更新、面板关闭
  await swatchButton.click();
  await expect.poll(swatchBg).not.toBe("rgb(32, 39, 44)");
  await expect(page.getByLabel("拾色器")).not.toBeVisible();

  // 记忆色：重新打开后草稿 = 上次应用的颜色
  await arrowButton.click();
  await expect(page.getByLabel("拾色器")).toBeVisible();
  await page.keyboard.press("Escape");

  // 点击编辑器正文 → popover 关闭
  const editorBox = await editor.boundingBox();
  if (!editorBox) throw new Error("编辑器不可见");
  await page.mouse.click(editorBox.x + 80, editorBox.y + 40);
  await expect(page.getByLabel("拾色器")).not.toBeVisible();
});

