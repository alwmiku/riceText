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
    title: "未命名文章",
    revision: 1,
  });
  expect(JSON.stringify(stored)).toContain("第一篇文章正文");
  const firstId = (stored as { id: string }).id;
  const secondStatus = await page.evaluate(async () => {
    const response = await fetch("/api/documents/second-post", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "第二篇文章",
        schemaVersion: 1,
        baseRevision: 0,
        clientMutationId: "create-second-e2e",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "第二篇正文" }] }],
        },
      }),
    });
    return response.status;
  });
  expect(secondStatus).toBe(201);

  await page.reload();
  const selector = page.getByRole("combobox", { name: "选择文章" });
  await expect(selector.locator("option")).toHaveCount(2);
  await selector.selectOption("second-post");
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
