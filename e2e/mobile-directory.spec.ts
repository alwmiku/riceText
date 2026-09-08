import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

for (const route of ["compose", "read"]) {
  test(route + " mobile directory follows viewport and tucks while reading forward", async ({ page, isMobile }, info) => {
    test.skip(!isMobile, "目录靠边交互仅用于手机布局");
    await page.setViewportSize({ width: 390, height: 844 });
    const documentId = "article_directory_" + randomUUID();
    const created = await page.request.put("/api/documents/" + documentId, {
      headers: { "x-user-id": "author", Origin: new URL(info.project.use.baseURL!).origin },
      data: { title: "目录滚动验收", schemaVersion: 1, baseRevision: 0, clientMutationId: randomUUID(),
        content: { type: "doc", content: Array.from({ length: 20 }, (_, index) => ({
          type: "paragraph", content: [{ type: "text", text: "第" + (index + 1) + "段。阅读时，目录入口应当始终跟随屏幕。正文向上移动时按钮收进左侧边缘，向下移动时按钮重新显现，方便回到章节目录。" }],
        })) },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    await page.addInitScript(id => { localStorage.setItem("ricetext:selected-document", id); }, documentId);
    await page.goto("/" + route);
    if (route === "compose") await page.getByRole("button", { name: "移动", exact: true }).click();
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const trigger = page.getByRole("button", { name: "打开章节目录", exact: true });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveCSS("position", "fixed");
    await expect(trigger).toHaveAttribute("data-revealed", "false");
    const initialTop = (await trigger.boundingBox())!.y;
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(trigger).toHaveAttribute("data-revealed", "false");
    await expect.poll(async () => (await trigger.boundingBox())!.x).toBeLessThan(0);
    expect(Math.abs((await trigger.boundingBox())!.y - initialTop)).toBeLessThan(1);
    await page.evaluate(() => window.scrollTo(0, 520));
    await expect(trigger).toHaveAttribute("data-revealed", "true");
    await expect.poll(async () => (await trigger.boundingBox())!.x).toBeGreaterThanOrEqual(7);
    const header = await page.getByRole("banner").boundingBox();
    expect((await trigger.boundingBox())!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
    await page.evaluate(() => window.scrollTo(0, 900));
    await expect(trigger).toHaveAttribute("data-revealed", "false");
    await expect.poll(async () => (await trigger.boundingBox())!.x).toBeLessThan(-20);
    const tucked = (await trigger.boundingBox())!;
    expect(tucked.x + tucked.width).toBeGreaterThan(10);
    await page.screenshot({ path: info.outputPath(route + "-tucked.png") });
    // 点击仍露在屏幕内的边缘部分，而不是依赖自动滚动找回按钮。
    await page.touchscreen.tap(5, tucked.y + tucked.height / 2);
    const drawerName = route === "compose" ? "章节目录" : "阅读章节目录";
    const drawer = page.getByRole("dialog", { name: drawerName, exact: true });
    await expect(drawer).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.touchscreen.tap(380, 400);
    await expect(drawer).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, 820));
    await expect(trigger).toHaveAttribute("data-revealed", "true");
    await page.screenshot({ path: info.outputPath(route + "-revealed.png") });
    await page.setViewportSize({ width: 320, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 1000));
    await expect(trigger).toHaveAttribute("data-revealed", "false");
    await expect.poll(async () => (await trigger.boundingBox())!.x).toBeLessThan(-20);
    await page.evaluate(() => window.scrollTo(0, 900));
    await expect(trigger).toHaveAttribute("data-revealed", "true");
    await expect.poll(async () => (await trigger.boundingBox())!.x).toBeGreaterThanOrEqual(7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  });
}
