import { expect, test } from "@playwright/test";

test("账号密码登录、刷新会话并退出", async ({ page }) => {
  await page.goto("/compose");
  await page.getByRole("button", { name: "登录" }).click();
  const dialog = page.getByRole("dialog", { name: "登录 RiceText" });
  await dialog.getByLabel("账号").fill("writer");
  await dialog.getByLabel("密码").fill("local-test-password");
  await dialog.getByRole("button", { name: "登录" }).click();

  await expect(page.getByRole("button", { name: "账户菜单" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "账户菜单" })).toBeVisible();
  await page.getByRole("button", { name: "账户菜单" }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
});
