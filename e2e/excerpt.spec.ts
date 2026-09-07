import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

const book = "穿越漫长星河之后我们终于抵达那座没有名字的城市与失落图书馆";
const chapter = "第一千二百三十四章 风雨之后重逢的旅人与一封迟到了很多年的信";
interface ReaderValues { readerTime: string; batteryLevel: string; pageLabel: string; progressLabel: string; headerLabel: string }
const author = "在遥远山海之间记录每一段故事的无名旅人AuthorWithoutSpaces0123456789";
const paragraphs = [
  "雨停的时候，城门外的石阶上还留着细小的水珠。她翻开那封信，熟悉的字迹像远处终于亮起的灯，让漫长的旅程有了归处。",
  "“你还记得那座图书馆吗？”他问。街角传来钟声，人们从不同方向走来，又各自走向新的清晨。",
  "他们没有立刻回答，只把书放在窗边。阳光越过书脊，照亮最后一页，也照亮尚未开始的故事。",
];

async function screenshot(page: Page, info: TestInfo, directory: string, name: string) {
  const path = resolve(directory, name + ".png");
  if (!name.startsWith("dialog")) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  }
  await page.screenshot({ path, fullPage: true, scale: "css", animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
  if (name.startsWith("reader")) {
    const excerpt = page.locator(".rt-reader-page");
    const clip = await excerpt.boundingBox();
    expect(clip).not.toBeNull();
    const excerptPath = resolve(directory, name + "-excerpt.png");
    await page.screenshot({ path: excerptPath, fullPage: true, clip: clip!, scale: "css", animations: "disabled" });
    await info.attach(name + "-excerpt", { path: excerptPath, contentType: "image/png" });
  }
}

async function assertExcerpt(excerpt: Locator, variant: string, chapterTitle: string, values: ReaderValues) {
  const { readerTime, batteryLevel, pageLabel, progressLabel, headerLabel } = values;
  await expect(excerpt).toBeVisible();
  await expect(excerpt).toHaveAttribute("data-variant", variant);
  const paper = excerpt.locator(".rt-reader-page");
  await expect(paper).toBeVisible();
  await expect(excerpt.locator(".rt-reader-chapter")).toHaveText(chapterTitle);
  const attribution = excerpt.locator(".rt-reader-attribution");
  await expect(attribution).toContainText(book);
  await expect(attribution).toContainText(author);
  await expect(attribution).toContainText(variant === "fanqie" ? "番茄轻小说" : "起点读书");
  await expect(paper.locator(".rt-reader-attribution")).toHaveCount(0);
  await expect(paper.locator(".rt-reader-book-title")).toHaveText(book);
  await expect(excerpt.locator(".rt-reader-status, .rt-reader-notifications, .rt-reader-status-icons")).toHaveCount(0);
  await expect(excerpt.locator(".rt-reader-battery")).toHaveCount(1);
  await expect(paper.locator(".rt-reader-bottomline .rt-reader-battery")).toHaveCount(1);
  const headingStyles = await paper.evaluate((root) => {
    const title = getComputedStyle(root.querySelector(".rt-reader-book-title")!);
    const chapter = getComputedStyle(root.querySelector(".rt-reader-chapter")!);
    const metrics = (style: CSSStyleDeclaration) => ({ family: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight, weight: style.fontWeight });
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
    };
    return { title: metrics(title), chapter: metrics(chapter), titleLight: luminance(title.color), chapterLight: luminance(chapter.color) };
  });
  expect(headingStyles.title).toEqual(headingStyles.chapter);
  expect(headingStyles.titleLight).toBeLessThan(headingStyles.chapterLight);
  await expect(excerpt.locator(".rt-reader-bottomline")).toContainText(readerTime);
  await expect(excerpt.locator(".rt-reader-progress")).toContainText(pageLabel);
  await expect(excerpt.locator(".rt-reader-progress")).toContainText(progressLabel);
  await expect(excerpt.locator(".rt-reader-header-label")).toHaveText(headerLabel);
  await expect(excerpt.locator(".rt-reader-bottomline [aria-label]")).toHaveAttribute("aria-label", new RegExp(batteryLevel));
  const text = excerpt.locator(".rt-novel-excerpt__content p");
  await expect(text).toHaveText(paragraphs);
  const metrics = await text.first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { font: parseFloat(style.fontSize), indent: parseFloat(style.textIndent) };
  });
  expect(metrics.font).toBeGreaterThanOrEqual(18);
  expect(metrics.font).toBeLessThanOrEqual(20);
  expect(metrics.indent).toBe(metrics.font * 2);
  const bubbles = await text.evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element, "::after");
    return { content: style.content, display: style.display };
  }));
  for (const bubble of bubbles) {
    if (variant === "qidian") {
      expect(bubble.content).toBe('""');
      expect(bubble.display).not.toBe("none");
    } else expect(["none", "normal"]).toContain(bubble.content);
  }
  await expect(excerpt.locator('[data-node-type="inline-comment-anchor"], .rt-inline-comment-anchor')).toHaveCount(0);
  await expect(attribution.locator("a")).toHaveAttribute("href", "https://example.com/excerpt-source");
}

async function assertLayout(page: Page, excerpt: Locator) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport!.width + 1);
  const issues = await excerpt.evaluate((root) => {
    const bounds = root.getBoundingClientRect();
    return [...root.querySelectorAll(".rt-reader-page, .rt-reader-book-title, .rt-reader-topline, .rt-reader-chapter, .rt-reader-header-label, .rt-novel-excerpt__content, p, .rt-reader-bottomline, .rt-reader-attribution")]
      .flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const errors: string[] = [];
        if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) errors.push(element.tagName + ": outside excerpt");
        if (element.scrollWidth > element.clientWidth + 1) errors.push(element.tagName + ": horizontal overflow");
        return errors;
      });
  });
  expect(issues).toEqual([]);
  const sections = await excerpt.evaluate((root) => {
    const box = (selector: string) => root.querySelector(selector)!.getBoundingClientRect();
    const title = box(".rt-reader-book-title");
    const top = box(".rt-reader-topline");
    const body = box(".rt-novel-excerpt__content");
    const footer = box(".rt-reader-bottomline");
    const paper = box(".rt-reader-page");
    const attribution = box(".rt-reader-attribution");
    return { titleEnd: title.bottom, topStart: top.top, topEnd: top.bottom, bodyStart: body.top, bodyEnd: body.bottom, footerStart: footer.top, footerEnd: footer.bottom, paperEnd: paper.bottom, attributionStart: attribution.top };
  });
  expect(sections.titleEnd).toBeLessThanOrEqual(sections.topStart + 1);
  expect(sections.topEnd).toBeLessThanOrEqual(sections.bodyStart + 1);
  expect(sections.bodyEnd).toBeLessThanOrEqual(sections.footerStart + 1);
  expect(sections.footerEnd).toBeLessThanOrEqual(sections.paperEnd + 1);
  expect(sections.paperEnd).toBeLessThanOrEqual(sections.attributionStart + 1);
}

async function assertMobileDirectory(page: Page, excerpt: Locator) {
  const trigger = page.getByRole("button", { name: "打开章节目录", exact: true });
  await expect(trigger).toBeVisible();
  const buttonBox = await trigger.boundingBox();
  const excerptBox = await excerpt.boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(excerptBox).not.toBeNull();
  expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(excerptBox!.y);
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "阅读章节目录", exact: true });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "关闭阅读目录", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
}

for (const variant of ["fanqie", "qidian"] as const) {
  for (const native320 of [false, true]) {
  test(variant + (native320 ? " native 320" : "") + " excerpt dialog, long metadata, paragraphs and persisted reader", async ({ page, isMobile }, info) => {
    test.skip(native320 && !isMobile, "Native narrow startup is a mobile acceptance case");
    test.setTimeout(90_000);
    const chapterTitle = native320 ? (variant === "fanqie" ? "第2章 这叫促进兄弟情谊" : "第1章 勤工俭学的小法师") : chapter;
    const values: ReaderValues = native320
      ? variant === "fanqie"
        ? { readerTime: "13:59", batteryLevel: "100", pageLabel: "16/843", progressLabel: "", headerLabel: "00:24得991金币" }
        : { readerTime: "10:18", batteryLevel: "75", pageLabel: "2/20", progressLabel: "1.0%", headerLabel: "起点热评 8" }
      : { readerTime: "14:28", batteryLevel: "73", pageLabel: "16/843", progressLabel: "1.9%", headerLabel: variant === "fanqie" ? "00:24得991金币" : "起点热评 8" };
    const { readerTime, batteryLevel, pageLabel, progressLabel, headerLabel } = values;
    const runId = info.project.name + "-" + variant + "-" + randomUUID();
    const directory = resolve("output", "excerpt", runId);
    await mkdir(directory, { recursive: true });
    if (!isMobile) await page.setViewportSize({ width: 1440, height: 1000 });
    else if (native320) await page.setViewportSize({ width: 320, height: 844 });
    await page.goto("/compose");
    await expect(page).toHaveTitle(/RiceText/);
    await expect(page.getByRole("heading", { name: "发帖与创作工作台" })).toBeVisible();
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
    await expect(editor.locator(".rt-novel-excerpt")).toHaveCount(0);
    if (!isMobile) await page.getByRole("button", { name: "完整", exact: true }).click();
    await editor.click();
    await page.keyboard.press("Control+End");
    if (isMobile) {
      await page.getByRole("button", { name: "插入内容", exact: true }).click();
      await page.getByRole("menuitem", { name: "小说摘录", exact: true }).click();
    } else {
      await page.getByRole("button", { name: "小说摘录", exact: true }).click();
    }
    const dialog = page.getByRole("dialog", { name: "插入小说摘录", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "插入摘录", exact: true })).toBeDisabled();
    await dialog.getByLabel("书名", { exact: true }).fill(book);
    await dialog.getByLabel("章节", { exact: true }).fill(chapterTitle);
    await dialog.getByLabel("作者", { exact: true }).fill(author);
    await dialog.getByRole("combobox", { name: "排版", exact: true }).selectOption(variant);
    await dialog.getByLabel("来源链接（可选）", { exact: true }).fill("https://example.com/excerpt-source");
    await dialog.getByLabel("时间", { exact: true }).fill(readerTime);
    await dialog.getByLabel("电量（%）", { exact: true }).fill(batteryLevel);
    await dialog.getByLabel("页码", { exact: true }).fill(pageLabel);
    await dialog.getByLabel("阅读进度", { exact: true }).fill(progressLabel);
    await dialog.getByLabel("顶部信息", { exact: true }).fill(headerLabel);
    await dialog.getByLabel("摘录正文", { exact: true }).fill(paragraphs.join("\n\n"));
    const preview = dialog.locator(".rt-novel-excerpt--" + variant);
    await assertExcerpt(preview, variant, chapterTitle, values);
    await preview.scrollIntoViewIfNeeded();
    await screenshot(page, info, directory, "dialog-preview");
    await assertLayout(page, preview);
    if (isMobile) {
      await page.setViewportSize({ width: 320, height: 844 });
      await preview.scrollIntoViewIfNeeded();
      await screenshot(page, info, directory, "dialog-preview-320");
      await assertLayout(page, preview);
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await dialog.getByRole("button", { name: "插入摘录", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const inserted = editor.locator(".rt-novel-excerpt--" + variant);
    await assertExcerpt(inserted, variant, chapterTitle, values);
    await inserted.scrollIntoViewIfNeeded();
    await screenshot(page, info, directory, "editor");
    await assertLayout(page, inserted);
    if (isMobile) {
      await page.setViewportSize({ width: 320, height: 844 });
      await screenshot(page, info, directory, "editor-320");
      await assertLayout(page, inserted);
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await page.getByRole("button", { name: isMobile ? "发布" : "保存", exact: true }).click();
    await expect(page.getByText("正文已保存，可切换到阅读视图检查", { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await assertExcerpt(inserted, variant, chapterTitle, values);
    expect(await page.evaluate(() => localStorage.getItem("ricetext:selected-document"))).toBe(documentId);
    await page.goto("/read");
    await expect(page.locator("[contenteditable=true]")).toHaveCount(0);
    const reader = page.locator(".rt-novel-excerpt--" + variant);
    await assertExcerpt(reader, variant, chapterTitle, values);
    await reader.scrollIntoViewIfNeeded();
    await screenshot(page, info, directory, "reader");
    await assertLayout(page, reader);
    if (isMobile) await assertMobileDirectory(page, reader);
    await page.reload();
    await assertExcerpt(reader, variant, chapterTitle, values);
    if (isMobile) {
      await page.setViewportSize({ width: 320, height: 844 });
      await reader.scrollIntoViewIfNeeded();
      await screenshot(page, info, directory, "reader-320");
      await assertLayout(page, reader);
      await assertMobileDirectory(page, reader);
    }
  });
  }
}
