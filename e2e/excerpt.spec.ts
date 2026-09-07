import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

const book = "穿越漫长星河之后我们终于抵达那座没有名字的城市与失落图书馆";
const chapter = "第一千二百三十四章 风雨之后重逢的旅人与一封迟到了很多年的信";
const source = "https://example.com/excerpt-source";
const paragraphs = [
  "雨停的时候，城门外的石阶上还留着细小的水珠。她翻开那封信，熟悉的字迹像远处终于亮起的灯，让漫长的旅程有了归处。",
  "“你还记得那座图书馆吗？”他问。街角传来钟声，人们从不同方向走来，又各自走向新的清晨。",
  "他们没有立刻回答，只把书放在窗边。阳光越过书脊，照亮最后一页，也照亮尚未开始的故事。",
];
const localTime = (page: Page) => page.evaluate(() => {
  const now = new Date();
  return String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
});

async function screenshot(page: Page, info: TestInfo, directory: string, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const path = resolve(directory, name + ".png");
  await page.screenshot({ path, fullPage: true, scale: "css", animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
  if (name.startsWith("reader")) {
    const clip = await page.locator(".rt-reader-page").boundingBox();
    expect(clip).not.toBeNull();
    const excerptPath = resolve(directory, name + "-excerpt.png");
    await page.screenshot({ path: excerptPath, fullPage: true, clip: clip!, scale: "css", animations: "disabled" });
    await info.attach(name + "-excerpt", { path: excerptPath, contentType: "image/png" });
  }
}

async function createExcerpt(page: Page, isMobile: boolean, variant: string, body: string[], info: TestInfo) {
  const runId = info.project.name + "-" + variant + "-" + randomUUID();
  const directory = resolve("output", "excerpt", runId);
  await mkdir(directory, { recursive: true });
  await page.goto("/compose");
  await expect(page).toHaveTitle(/RiceText/);
  const previousId = await page.evaluate(() => localStorage.getItem("ricetext:selected-document"));
  await page.getByRole("button", { name: "新文章", exact: true }).click();
  const create = page.getByRole("dialog", { name: "新建文章", exact: true });
  await create.getByLabel("文章名称").fill("Excerpt acceptance " + runId);
  await create.getByRole("button", { name: "创建", exact: true }).click();
  await expect(create).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ricetext:selected-document"))).not.toBe(previousId);
  const documentId = await page.evaluate(() => localStorage.getItem("ricetext:selected-document"));
  expect(documentId).toMatch(/^article_/);
  info.annotations.push({ type: "document", description: documentId! });
  const editor = page.locator(".ProseMirror[contenteditable=true]");
  await expect(editor).toBeVisible();
  if (!isMobile) await page.getByRole("button", { name: "完整", exact: true }).click();
  await editor.click();
  await page.keyboard.press("Control+End");
  if (isMobile) {
    await page.getByRole("button", { name: "插入内容", exact: true }).click();
    await page.getByRole("menuitem", { name: "小说摘录", exact: true }).click();
  } else await page.getByRole("button", { name: "小说摘录", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "插入小说摘录", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "插入摘录", exact: true })).toBeDisabled();
  await dialog.getByLabel("书名", { exact: true }).fill(book);
  await dialog.getByLabel("章节", { exact: true }).fill(chapter);
  await dialog.getByLabel("作者", { exact: true }).fill("无名旅人AuthorWithoutSpaces0123456789");
  await dialog.getByRole("combobox", { name: "排版", exact: true }).selectOption(variant);
  await dialog.getByLabel("来源链接（可选）", { exact: true }).fill(source);
  await expect(dialog.getByLabel("时间", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("页码", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("阅读进度", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("电量（%）", { exact: true }).fill("73");
  await dialog.getByLabel("摘录正文", { exact: true }).fill(body.join("\n\n"));
  const preview = dialog.locator(".rt-novel-excerpt--" + variant);
  await assertExcerpt(preview, variant, body);
  await assertLayout(page, preview);
  const before = await localTime(page);
  await dialog.getByRole("button", { name: "插入摘录", exact: true }).click();
  const after = await localTime(page);
  await expect(dialog).not.toBeVisible();
  const inserted = editor.locator(".rt-novel-excerpt--" + variant);
  await expect(inserted).toBeVisible();
  const time = await inserted.getAttribute("data-reader-time");
  expect([before, after]).toContain(time);
  await expect(inserted.locator(".rt-reader-clock")).toContainText(time!);
  return { inserted, documentId, directory, time: time! };
}

async function assertExcerpt(excerpt: Locator, variant: string, body: string[], time?: string) {
  await expect(excerpt).toBeVisible();
  await expect(excerpt).toHaveAttribute("data-variant", variant);
  const paper = excerpt.locator(".rt-reader-page");
  await expect(paper.locator(".rt-reader-book-title")).toHaveText("《" + book + "》");
  const titleLink = paper.locator(".rt-reader-book-title a");
  await expect(titleLink).toHaveAttribute("href", source);
  await expect(titleLink).toHaveCSS("text-decoration-line", "none");
  await expect(excerpt.locator(".rt-reader-attribution, .rt-reader-status, .rt-reader-notifications")).toHaveCount(0);
  await expect(excerpt.locator(".rt-reader-chapter")).toHaveText(chapter);
  const headerLabel = paper.locator(".rt-reader-header-label");
  await expect(headerLabel).toHaveCSS("white-space", "nowrap");
  const labelMetrics = await headerLabel.evaluate(element => {
    const text = element.querySelector<HTMLElement>(".rt-reader-header-text")!;
    const arrow = element.querySelector<HTMLElement>(".rt-reader-next");
    const bounds = text.getBoundingClientRect();
    const arrowBounds = arrow?.getBoundingClientRect();
    return { height: bounds.height, lineHeight: parseFloat(getComputedStyle(text).lineHeight),
      overflow: text.scrollWidth - text.clientWidth,
      arrowRightOfText: !arrowBounds || arrowBounds.left >= bounds.right - 1,
      centerDifference: arrowBounds ? Math.abs((arrowBounds.top + arrowBounds.bottom - bounds.top - bounds.bottom) / 2) : 0 };
  });
  expect(labelMetrics.height).toBeLessThanOrEqual(labelMetrics.lineHeight + 1);
  expect(labelMetrics.overflow).toBeLessThanOrEqual(1);
  expect(labelMetrics.arrowRightOfText).toBe(true);
  expect(labelMetrics.centerDifference).toBeLessThanOrEqual(1);
  await expect(excerpt.locator(".rt-reader-battery")).toHaveCount(1);
  await expect(paper.locator(".rt-reader-bottomline .rt-reader-battery")).toHaveAttribute("aria-label", "电量 73%");
  if (time) {
    await expect(excerpt).toHaveAttribute("data-reader-time", time);
    await expect(excerpt.locator(".rt-reader-clock")).toContainText(time);
  }
  const text = excerpt.locator(".rt-novel-excerpt__content p");
  await expect(text).toHaveText(body);
  const metrics = await text.first().evaluate((element) => {
    const style = getComputedStyle(element);
    const host = element.closest(".ProseMirror");
    if (!host) throw new Error("Missing article/editor typography host");
    return { font: parseFloat(style.fontSize), hostFont: parseFloat(getComputedStyle(host).fontSize), indent: parseFloat(style.textIndent) };
  });
  expect(metrics.font).toBe(metrics.hostFont);
  expect(metrics.indent).toBe(metrics.font * 2);
  const bubbles = await text.evaluateAll((elements) => elements.map((element) => getComputedStyle(element, "::after").content));
  for (const bubble of bubbles) {
    if (variant === "qidian") expect(bubble).toBe('""');
    else expect(["none", "normal"]).toContain(bubble);
  }
  await expect(excerpt.locator('[data-node-type="inline-comment-anchor"], .rt-inline-comment-anchor')).toHaveCount(0);
}

async function assertLayout(page: Page, excerpt: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  const issues = await excerpt.evaluate((root) => {
    const bounds = root.getBoundingClientRect();
    const paginated = root.querySelector(".rt-reader-page")?.getAttribute("data-paginated") === "true";
    const elements = [...root.querySelectorAll(".rt-reader-page, .rt-reader-book-title, .rt-reader-topline, .rt-reader-chapter, .rt-reader-header-label, .rt-reader-viewport, .rt-reader-bottomline")];
    if (!paginated) elements.push(...root.querySelectorAll(".rt-novel-excerpt__content, p"));
    return elements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || (element.scrollWidth > element.clientWidth + 1 && !element.matches(".rt-reader-viewport")) ? [element.className] : [];
    });
  });
  expect(issues).toEqual([]);
  const sections = await excerpt.evaluate((root) => {
    const box = (selector: string) => root.querySelector(selector)!.getBoundingClientRect();
    const title = box(".rt-reader-book-title"), top = box(".rt-reader-topline"), body = box(".rt-reader-viewport"), footer = box(".rt-reader-bottomline"), paper = box(".rt-reader-page");
    return { titleEnd: title.bottom, topStart: top.top, topEnd: top.bottom, bodyStart: body.top, bodyEnd: body.bottom, footerStart: footer.top, footerEnd: footer.bottom, paperEnd: paper.bottom };
  });
  expect(sections.titleEnd).toBeLessThanOrEqual(sections.topStart + 1);
  expect(sections.topEnd).toBeLessThanOrEqual(sections.bodyStart + 1);
  expect(sections.bodyEnd).toBeLessThanOrEqual(sections.footerStart + 1);
  expect(sections.footerEnd).toBeLessThanOrEqual(sections.paperEnd + 1);
}

async function saveAndRead(page: Page, isMobile: boolean) {
  await page.getByRole("button", { name: isMobile ? "发布" : "保存", exact: true }).click();
  await expect(page.getByText("正文已保存，可切换到阅读视图检查", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await page.goto("/read");
  await expect(page.locator("[contenteditable=true]")).toHaveCount(0);
}

for (const variant of ["fanqie", "qidian"] as const) {
  for (const native320 of [false, true]) {
    test(variant + (native320 ? " native 320" : "") + " excerpt title, generated time and persisted reader", async ({ page, isMobile }, info) => {
      test.skip(native320 && !isMobile, "Native narrow startup is a mobile acceptance case");
      test.setTimeout(90_000);
      await page.setViewportSize({ width: isMobile ? native320 ? 320 : 390 : 1440, height: isMobile ? 844 : 1000 });
      const { inserted, directory, time, documentId } = await createExcerpt(page, isMobile, variant, paragraphs, info);
      await assertExcerpt(inserted, variant, paragraphs, time);
      await expect(inserted).toHaveAttribute("data-page-count", "1");
      await expect(inserted.locator(".rt-reader-progress")).toContainText("1/1");
      await assertLayout(page, inserted);
      await screenshot(page, info, directory, "editor");
      await saveAndRead(page, isMobile);
      const reader = page.locator(".rt-novel-excerpt--" + variant);
      await assertExcerpt(reader, variant, paragraphs, time);
      await assertLayout(page, reader);
      await screenshot(page, info, directory, "reader");
      await page.reload();
      await assertExcerpt(reader, variant, paragraphs, time);
      expect(await page.evaluate(() => localStorage.getItem("ricetext:selected-document"))).toBe(documentId);
      if (isMobile) {
        await page.setViewportSize({ width: 320, height: 844 });
        await assertLayout(page, reader);
        await screenshot(page, info, directory, "reader-320");
      }
    });
  }
}

for (const variant of ["fanqie", "qidian"] as const) {
  test(variant + " mobile readonly pagination preserves every character and ignores selection", async ({ page, isMobile, context }, info) => {
    test.skip(!isMobile, "Touch pagination is mobile-only");
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const body = Array.from({ length: 14 }, (_, i) => "第" + (i + 1) + "段。" + paragraphs[i % paragraphs.length]! + "这段文字的结尾必须完整显示，翻页不能遗漏任何一行。");
    const { inserted, directory, time } = await createExcerpt(page, true, variant, body, info);
    await expect(inserted).toHaveAttribute("data-page-count", "1");
    await expect(inserted.locator(".rt-reader-page")).not.toHaveAttribute("data-paginated", "true");
    await saveAndRead(page, true);
    const reader = page.locator(".rt-novel-excerpt--" + variant);
    const viewport = reader.locator(".rt-reader-viewport");
    await expect(reader.locator(".rt-reader-page")).toHaveAttribute("data-paginated", "true");
    await expect.poll(async () => Number(await reader.getAttribute("data-page-count"))).toBeGreaterThan(2);
    const count = Number(await reader.getAttribute("data-page-count"));
    const tap = async (right: boolean) => {
      const box = await viewport.boundingBox();
      expect(box).not.toBeNull();
      await viewport.tap({ position: { x: box!.width * (right ? 0.88 : 0.12), y: box!.height * 0.48 } });
    };
    await expect(reader).toHaveAttribute("data-page-index", "0");
    await tap(false);
    await expect(reader).toHaveAttribute("data-page-index", "0");
    await screenshot(page, info, directory, "reader-first");
    const link = reader.locator(".rt-reader-book-title a");
    await link.hover();
    await expect(link).toHaveCSS("text-decoration-line", "none");
    await link.focus();
    await expect(link).toHaveCSS("text-decoration-line", "none");
    await context.route(source, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Source intercepted</title>Source" }));
    const popupPromise = page.waitForEvent("popup");
    await link.scrollIntoViewIfNeeded();
    const linkBox = await link.boundingBox();
    await page.mouse.move(linkBox!.x + 5, linkBox!.y + 5);
    await page.mouse.down();
    await expect(link).toHaveCSS("text-decoration-line", "none");
    await page.mouse.up();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(source);
    await popup.close();
    await expect(reader).toHaveAttribute("data-page-index", "0");
    await reader.locator(".rt-reader-bottomline").tap();
    await expect(reader).toHaveAttribute("data-page-index", "0");
    await viewport.evaluate((element) => {
      const text = element.querySelector("p")!.firstChild!;
      const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, Math.min(8, text.textContent!.length));
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    });
    await tap(true);
    await expect(reader).toHaveAttribute("data-page-index", "0");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await viewport.scrollIntoViewIfNeeded();
    const dragBox = await viewport.boundingBox();
    await page.mouse.move(dragBox!.x + dragBox!.width * .8, dragBox!.y + 25);
    await page.mouse.down();
    await page.mouse.move(dragBox!.x + dragBox!.width * .2, dragBox!.y + 25, { steps: 8 });
    await page.mouse.up();
    await expect(reader).toHaveAttribute("data-page-index", "0");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    const seen = new Set<number>();
    let total = 0;
    const characterEvidence = new Map<number, { char: string; left: number; right: number; top: number; bottom: number; distance: number; page: number }>();
    for (let index = 0; index < count; index++) {
      await expect(reader).toHaveAttribute("data-page-index", String(index));
      await assertLayout(page, reader);
      const visible = await viewport.evaluate((root) => {
        const bounds = root.getBoundingClientRect();
        const walker = document.createTreeWalker(root.querySelector(".rt-novel-excerpt__content")!, NodeFilter.SHOW_TEXT);
        const found: number[] = [], clipped: number[] = [];
        const evidence: { offset: number; char: string; left: number; right: number; top: number; bottom: number; distance: number }[] = [];
        let offset = 0, node;
        while ((node = walker.nextNode())) {
          for (let i = 0; i < node.textContent!.length; i++, offset++) {
            if (!node.textContent![i]!.trim()) continue;
            const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
            const rect = range.getBoundingClientRect();
            evidence.push({ offset, char: node.textContent![i]!, left: rect.left - bounds.left, right: rect.right - bounds.right, top: rect.top - bounds.top, bottom: rect.bottom - bounds.bottom, distance: Math.abs((rect.left + rect.right - bounds.left - bounds.right) / 2) });
            if (rect.width && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1) {
              if (rect.top >= bounds.top - 2 && rect.bottom <= bounds.bottom + 2) found.push(offset);
              else if (rect.bottom > bounds.top && rect.top < bounds.bottom) clipped.push(offset);
            }
          }
        }
        return { found, clipped, total: offset, evidence };
      });
      expect(visible.clipped).toEqual([]);
      for (const position of visible.found) seen.add(position);
      for (const item of visible.evidence) {
        const previous = characterEvidence.get(item.offset);
        if (!previous || item.distance < previous.distance) characterEvidence.set(item.offset, { ...item, page: index });
      }
      await expect(reader.locator(".rt-reader-progress")).toContainText((index + 1) + "/" + count);
      total = visible.total;
      if (index === 1) await screenshot(page, info, directory, "reader-second");
      if (index < count - 1) await tap(true);
    }
    const missing = [...characterEvidence.entries()].filter(([position]) => !seen.has(position));
    expect(missing, JSON.stringify({ total, count, missing })).toEqual([]);
    expect(seen.size).toBe(total);
    await screenshot(page, info, directory, "reader-last");
    await tap(true);
    await expect(reader).toHaveAttribute("data-page-index", String(count - 1));
    await viewport.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(reader).toHaveAttribute("data-page-index", String(count - 2));
    await page.keyboard.press("ArrowRight");
    await expect(reader).toHaveAttribute("data-page-index", String(count - 1));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(reader).toHaveAttribute("data-page-count", "1");
    await expect(reader).toHaveAttribute("data-page-index", "0");
    await expect(reader.locator(".rt-reader-progress")).toContainText("1/1");
    await assertExcerpt(reader, variant, body, time);
    await assertLayout(page, reader);
    await screenshot(page, info, directory, "reader-desktop-full");
    await page.setViewportSize({ width: 320, height: 844 });
    await expect(reader.locator(".rt-reader-page")).toHaveAttribute("data-paginated", "true");
    await expect.poll(async () => Number(await reader.getAttribute("data-page-count"))).toBeGreaterThan(2);
    const resizedIndex = Number(await reader.getAttribute("data-page-index"));
    expect(resizedIndex).toBeGreaterThanOrEqual(0);
    expect(resizedIndex).toBeLessThan(Number(await reader.getAttribute("data-page-count")));
    await assertLayout(page, reader);
    await page.reload();
    await expect(reader).toHaveAttribute("data-page-index", "0");
    await assertExcerpt(reader, variant, body, time);
  });
}
