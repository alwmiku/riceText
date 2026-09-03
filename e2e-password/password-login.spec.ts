import { expect, test } from "@playwright/test";

test("账号密码登录、刷新会话并退出", async ({ page }) => {
  const guestRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("guest-local")) guestRequests.push(request.url());
  });
  await page.goto("/compose");
  const guestEditor = page.locator(".ProseMirror");
  await expect(guestEditor).toHaveAttribute("contenteditable", "true");
  await expect(guestEditor).toHaveText("");
  const anonymousStatus = await page.evaluate(async () =>
    (await fetch("/api/documents")).status,
  );
  expect(anonymousStatus).toBe(401);
  await page.waitForTimeout(200);
  expect(guestRequests).toEqual([]);
  await page.getByRole("link", { name: "阅读" }).click();
  await expect(page).toHaveURL(/\/compose$/);

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
  const firstDialog = page.getByRole("dialog", { name: "新建文章" });
  await firstDialog.getByLabel("文章名称").fill("第一篇文章");
  await firstDialog.getByRole("button", { name: "创建" }).click();
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
    const listResponse = await fetch("/api/documents");
    const list = (await listResponse.json()) as { items: Array<{ id: string }> };
    const response = await fetch("/api/documents/" + list.items[0]!.id);
    return response.json();
  });
  expect(stored).toMatchObject({
    title: "第一篇文章",
    revision: 1,
  });
  expect(JSON.stringify(stored)).toContain("第一篇文章正文");
  const firstId = (stored as { id: string }).id;
  await page.getByRole("button", { name: "新文章" }).click();
  const secondDialog = page.getByRole("dialog", { name: "新建文章" });
  await secondDialog.getByLabel("文章名称").fill("第二篇文章");
  await secondDialog.getByRole("button", { name: "创建" }).click();
  await expect(page.locator(".ProseMirror")).toHaveText("");
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("第二篇正文");
  await expect(page.locator(".save-status")).toContainText("已自动保存到本地", {
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("已保存到服务器", {
    timeout: 10_000,
  });
  const secondStored = await page.evaluate(async () => {
    const list = (await (await fetch("/api/documents")).json()) as {
      items: Array<{ id: string; title: string }>;
    };
    const id = list.items.find((item) => item.title === "第二篇文章")!.id;
    return (await (await fetch("/api/documents/" + id)).json()) as unknown;
  });
  expect(JSON.stringify(secondStored)).toContain("第二篇正文");

  await page.reload();
  const selector = page.getByRole("combobox", { name: "选择文章" });
  await expect(selector.locator("option")).toHaveCount(2);
  const secondId = await page.evaluate(async () => {
    const response = await fetch("/api/documents");
    const list = (await response.json()) as {
      items: Array<{ id: string; title: string }>;
    };
    return list.items.find((item) => item.title === "第二篇文章")!.id;
  });
  await selector.selectOption(secondId);
  await expect(page.locator(".ProseMirror")).toContainText("第二篇正文");
  await selector.selectOption(firstId);
  await expect(page.locator(".ProseMirror")).toContainText("第一篇文章正文");

  await page.reload();
  await expect(page.getByRole("button", { name: "账户菜单" })).toBeVisible();
  await expect(page.locator(".ProseMirror")).toContainText("第一篇文章正文");
  await page.getByRole("button", { name: "账户菜单" }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
});
