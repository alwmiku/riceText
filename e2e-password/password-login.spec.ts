import { expect, test } from "@playwright/test";

test("账号密码登录、刷新会话并退出", async ({ page }) => {
  await page.goto("/compose");
  await page.getByRole("button", { name: "登录" }).click();
  const dialog = page.getByRole("dialog", { name: "登录 RiceText" });
  await dialog.getByLabel("账号").fill("writer");
  await dialog.getByLabel("密码").fill("local-test-password");
  await dialog.getByRole("button", { name: "登录" }).click();

  await expect(page.getByRole("button", { name: "账户菜单" })).toBeVisible();
  await expect(page.getByText("雾港来信", { exact: false })).toHaveCount(0);

  const create = page.getByRole("button", { name: "创建文章" });
  await expect(create).toBeVisible();
  await create.click();
  const editor = page.locator(".ProseMirror");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(editor).toHaveText("");
  await editor.click();
  await page.keyboard.type("第一篇文章正文");
  await expect(page.locator(".save-status")).toContainText("已自动保存到本地", {
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("已保存到服务器", {
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: "新增章节" })).toBeVisible();

  const stored = await page.evaluate(async () => {
    const response = await fetch("/api/documents/demo-post");
    return response.json();
  });
  expect(stored).toMatchObject({
    id: "demo-post",
    title: "未命名文章",
    revision: 1,
  });
  expect(JSON.stringify(stored)).toContain("第一篇文章正文");

  await page.reload();
  await expect(page.getByRole("button", { name: "账户菜单" })).toBeVisible();
  await expect(page.locator(".ProseMirror")).toContainText("第一篇文章正文");
  await page.getByRole("button", { name: "账户菜单" }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
});
