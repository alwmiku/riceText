import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

const templates = [
  { variant: "fanqie", name: "番茄轻小说", battery: "100" },
  { variant: "qidian", name: "起点读书", battery: "75" },
  { variant: "sfacg", name: "菠萝包轻小说", battery: "75" },
  { variant: "ciweimao", name: "刺猬猫阅读", battery: "75" },
] as const;
type Variant = (typeof templates)[number]["variant"];

const book = "穿越漫长星河之后我们终于抵达那座没有名字的城市与失落图书馆";
const chapter = "第一千二百三十四章 风雨之后重逢的旅人与一封迟到了很多年的信";
const source = "https://example.com/excerpt-source";
const paragraphs = [
  "雨停的时候，城门外的石阶上还留着细小的水珠。她翻开那封信，熟悉的字迹像远处终于亮起的灯，让漫长的旅程有了归处。",
  "“你还记得那座图书馆吗？”他问。街角传来钟声，人们从不同方向走来，又各自走向新的清晨。",
  "他们没有立刻回答，只把书放在窗边。阳光越过书脊，照亮最后一页，也照亮尚未开始的故事。",
];
const localTime = (page: Page) =>
  page.evaluate(() => {
    const now = new Date();
    return (
      String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0")
    );
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
    await page.screenshot({
      path: excerptPath,
      fullPage: true,
      clip: clip!,
      scale: "css",
      animations: "disabled",
    });
    await info.attach(name + "-excerpt", { path: excerptPath, contentType: "image/png" });
  }
}

async function createExcerpt(
  page: Page,
  isMobile: boolean,
  variant: Variant,
  body: string[],
  info: TestInfo,
) {
  const runId = info.project.name + "-" + variant + "-" + randomUUID();
  const directory = resolve("output", "excerpt", runId);
  await mkdir(directory, { recursive: true });
  await page.goto("/compose");
  await expect(page).toHaveTitle(/RiceText/);
  const previousId = await page.evaluate(() => localStorage.getItem("ricetext:selected-document"));
  await page.getByRole("button", { name: "新文章", exact: true }).click();
  const create = page.getByRole("dialog", { name: "新建文章", exact: true });
  await create.getByLabel("文章名称").fill("摘录验收 " + runId);
  await create.getByRole("button", { name: "创建", exact: true }).click();
  await expect(create).not.toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("ricetext:selected-document")))
    .not.toBe(previousId);
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
  await expect(
    dialog.getByRole("combobox", { name: "排版", exact: true }).locator("option"),
  ).toHaveText(templates.map((template) => template.name));
  await expect(dialog.getByRole("button", { name: "插入摘录", exact: true })).toBeDisabled();
  await dialog.getByLabel("书名", { exact: true }).fill(book);
  await dialog.getByLabel("章节", { exact: true }).fill(chapter);
  await dialog.getByLabel("作者", { exact: true }).fill("无名旅人AuthorWithoutSpaces0123456789");
  await dialog.getByRole("combobox", { name: "排版", exact: true }).selectOption(variant);
  await expect(dialog.getByLabel("电量（%）", { exact: true })).toHaveValue(
    templates.find((template) => template.variant === variant)!.battery,
  );
  await expect(dialog.getByLabel("顶部信息", { exact: true })).toHaveCount(
    variant === "sfacg" || variant === "ciweimao" ? 0 : 1,
  );
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

async function assertExcerpt(excerpt: Locator, variant: Variant, body: string[], time?: string) {
  await expect(excerpt).toBeVisible();
  await expect(excerpt).toHaveAttribute("data-variant", variant);
  const paper = excerpt.locator(".rt-reader-page");
  await expect(paper.locator(".rt-reader-book-title")).toHaveText("《" + book + "》");
  const titleLink = paper.locator(".rt-reader-book-title a");
  await expect(titleLink).toHaveAttribute("href", source);
  await expect(titleLink).toHaveCSS("text-decoration-line", "none");
  await expect(
    excerpt.locator(".rt-reader-attribution, .rt-reader-status, .rt-reader-notifications"),
  ).toHaveCount(0);
  await expect(excerpt.locator(".rt-reader-chapter")).toHaveText(chapter);
  const headerLabel = paper.locator(".rt-reader-header-label");
  if (variant === "sfacg" || variant === "ciweimao") {
    await expect(headerLabel).toHaveCount(0);
  } else {
    await expect(headerLabel).toHaveCSS("white-space", "nowrap");
    const labelMetrics = await headerLabel.evaluate((element) => {
      const text = element.querySelector<HTMLElement>(".rt-reader-header-text")!;
      const arrow = element.querySelector<HTMLElement>(".rt-reader-next");
      const bounds = text.getBoundingClientRect();
      const arrowBounds = arrow?.getBoundingClientRect();
      return {
        height: bounds.height,
        lineHeight: parseFloat(getComputedStyle(text).lineHeight),
        overflow: text.scrollWidth - text.clientWidth,
        arrowRightOfText: !arrowBounds || arrowBounds.left >= bounds.right - 1,
        centerDifference: arrowBounds
          ? Math.abs((arrowBounds.top + arrowBounds.bottom - bounds.top - bounds.bottom) / 2)
          : 0,
      };
    });
    expect(labelMetrics.height).toBeLessThanOrEqual(labelMetrics.lineHeight + 1);
    expect(labelMetrics.overflow).toBeLessThanOrEqual(1);
    expect(labelMetrics.arrowRightOfText).toBe(true);
    expect(labelMetrics.centerDifference).toBeLessThanOrEqual(1);
  }
  await expect(excerpt.locator(".rt-reader-battery")).toHaveCount(1);
  await expect(paper.locator(".rt-reader-bottomline .rt-reader-battery")).toHaveAttribute(
    "aria-label",
    "电量 73%",
  );
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
    return {
      font: parseFloat(style.fontSize),
      hostFont: parseFloat(getComputedStyle(host).fontSize),
      indent: parseFloat(style.textIndent),
    };
  });
  expect(metrics.font).toBe(metrics.hostFont);
  expect(metrics.indent).toBe(metrics.font * 2);
  await expect(excerpt).toHaveAttribute("data-empty-bubble", String(variant !== "fanqie"));
  // 四种模板的阅读页统一为圆角矩形卡片。
  const cardRadius = await paper.evaluate((element) =>
    parseFloat(getComputedStyle(element).borderTopLeftRadius),
  );
  expect(cardRadius).toBeGreaterThan(0);
  const bubbles = await text.evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element, "::after");
      return {
        content: style.content,
        pointerEvents: style.pointerEvents,
        borderRadius: style.borderRadius,
        width: style.width,
        height: style.height,
        float: style.float,
      };
    }),
  );
  for (const bubble of bubbles) {
    if (variant !== "fanqie") {
      expect(bubble.content).toBe('""');
      expect(bubble.pointerEvents).toBe("none");
      // 菠萝包与刺猬猫的段尾装饰仍浮动在栏宽右边缘，与书站一致。
      expect(bubble.float).toBe(variant === "qidian" ? "none" : "right");
      if (variant === "ciweimao") {
        expect(bubble.borderRadius).toBe("50%");
        expect(bubble.width).toBe(bubble.height);
      }
    } else expect(["none", "normal"]).toContain(bubble.content);
  }
  // 正文相对卡片的左右内缩必须相等：右侧不再为段尾装饰多留一栏。
  const column = await text.first().evaluate((element) => {
    const page = element.closest(".rt-reader-page") as HTMLElement;
    const pageBox = page.getBoundingClientRect();
    const paragraphStyle = getComputedStyle(element);
    const paragraphBox = element.getBoundingClientRect();
    const gutter = parseFloat(paragraphStyle.paddingInlineEnd);
    return {
      leftInset: Math.round(paragraphBox.left - pageBox.left),
      rightInset: Math.round(pageBox.right - (paragraphBox.right - gutter)),
    };
  });
  expect(column.leftInset).toBeGreaterThan(0);
  expect(Math.abs(column.leftInset - column.rightInset)).toBeLessThanOrEqual(1);
  await assertProgress(excerpt, variant);
  await assertPlatform(excerpt, variant);
  await expect(
    excerpt.locator('[data-node-type="inline-comment-anchor"], .rt-inline-comment-anchor'),
  ).toHaveCount(0);
}

async function assertProgress(excerpt: Locator, variant: Variant) {
  await expect
    .poll(async () => {
      const index = Number(await excerpt.getAttribute("data-page-index"));
      const count = Number(await excerpt.getAttribute("data-page-count"));
      const percent = ((index + 1) / count) * 100;
      const percentage =
        variant === "ciweimao" ? percent.toFixed(2) + "%" : Math.round(percent) + "%";
      const pageLabel = String(index + 1) + "/" + count;
      const expectedProgress =
        pageLabel + (variant === "qidian" || variant === "ciweimao" ? percentage : "");
      return {
        validState:
          Number.isInteger(index) &&
          Number.isInteger(count) &&
          count >= 1 &&
          index >= 0 &&
          index < count,
        progressMatches:
          (await excerpt.locator(".rt-reader-progress").textContent()) === expectedProgress,
        percentageMatches:
          variant === "fanqie"
            ? (await excerpt.locator(".rt-reader-percentage").count()) === 0
            : (await excerpt.locator(".rt-reader-percentage").textContent()) === percentage,
      };
    })
    .toEqual({ validState: true, progressMatches: true, percentageMatches: true });
}

async function assertPlatform(excerpt: Locator, variant: Variant) {
  const paper = excerpt.locator(".rt-reader-page");
  const footer = paper.locator(".rt-reader-bottomline");
  if (variant === "sfacg") {
    await expect(paper.locator(":scope > .rt-reader-book-title")).toHaveCount(0);
    const footerTitle = footer.locator(".rt-reader-book-meta .rt-reader-book-title");
    await expect(footerTitle).toHaveCount(1);
    await expect(footerTitle).toHaveCSS("white-space", "nowrap");
    await expect(footerTitle.locator("a")).toHaveCSS("text-overflow", "ellipsis");
    const titleLines = await footerTitle.evaluate((element) => {
      const style = getComputedStyle(element);
      return element.getBoundingClientRect().height / parseFloat(style.lineHeight);
    });
    expect(titleLines).toBeLessThanOrEqual(1.05);
    await expect(paper).toHaveCSS("background-color", "rgb(204, 204, 204)");
    await expect(excerpt.locator(".rt-novel-excerpt__content p").first()).toHaveCSS(
      "font-family",
      /KaiTi/i,
    );
    await expect(paper.locator(".rt-reader-topline")).toHaveCSS("text-align", "center");
    await expect(paper.locator(".rt-reader-topline .rt-reader-moon")).toBeVisible();
    await expect(footer.locator(".rt-reader-clock > :first-child")).toHaveClass(
      "rt-reader-battery",
    );
    const progress = footer.locator(".rt-reader-progress");
    await expect(progress).toHaveCSS("clip-path", "inset(50%)");
    await expect(progress).toHaveCSS("width", "1px");
    await expect(progress).toHaveAttribute("aria-live", "polite");
    await expect(progress).not.toHaveAttribute("aria-hidden", "true");
  } else {
    await expect(paper.locator(":scope > .rt-reader-book-title")).toHaveCount(1);
    await expect(footer.locator(".rt-reader-book-title")).toHaveCount(0);
  }
  if (variant === "ciweimao") {
    await expect(paper).toHaveCSS("background-color", "rgb(248, 248, 248)");
    await expect(excerpt.locator(".rt-novel-excerpt__content p").first()).toHaveCSS(
      "font-family",
      /sans-serif/,
    );
    await expect(paper.locator(".rt-reader-back")).toHaveCount(0);
    await expect(paper.locator(".rt-reader-viewport")).toHaveCSS(
      "background-image",
      /linear-gradient/,
    );
    await expect(paper.locator(".rt-reader-viewport")).toHaveCSS("background-size", "1px 100%");
    await expect(paper.locator(".rt-reader-viewport")).toHaveCSS("background-position-x", /100%/);
    await expect(footer.locator(".rt-reader-progress .rt-reader-percentage")).toHaveText(
      /^\d+\.\d{2}%$/,
    );
    await expect(footer.locator(".rt-reader-danmaku")).toHaveText("开启弹幕");
    // 细轨道位于正文右边缘，段尾圆点的中心必须落在轨道上。
    const dotCenter = await excerpt
      .locator(".rt-novel-excerpt__content p")
      .first()
      .evaluate((element) => {
        const pseudo = getComputedStyle(element, "::after");
        const paragraph = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return (
          box.right -
          parseFloat(paragraph.paddingRight) -
          parseFloat(pseudo.marginRight) -
          parseFloat(pseudo.width) / 2
        );
      });
    const trackCenter = await paper.locator(".rt-reader-viewport").evaluate((element) => {
      const style = getComputedStyle(element);
      const raw = style.getPropertyValue("--reader-track-inset").trim();
      const offset = raw.endsWith("em")
        ? parseFloat(raw) * parseFloat(style.fontSize)
        : parseFloat(raw);
      // 轨道是 1px 宽的背景，位置为 right <offset>，取其中心。
      return element.getBoundingClientRect().right - offset - 0.5;
    });
    expect(Math.abs(dotCenter - trackCenter)).toBeLessThanOrEqual(1);
  }
  const decorations = paper.locator(".rt-reader-moon, .rt-reader-danmaku");
  for (const decoration of await decorations.all()) {
    await expect(decoration).toHaveAttribute("aria-hidden", "true");
    expect(
      await decoration.evaluate((element) => {
        const interactive =
          'a, button, input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';
        return element.matches(interactive) || element.querySelector(interactive) !== null;
      }),
    ).toBe(false);
    await expect(decoration).not.toContainText(/\d/);
  }
}

async function assertLayout(page: Page, excerpt: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
  const issues = await excerpt.evaluate((root) => {
    const bounds = root.getBoundingClientRect();
    const paginated =
      root.querySelector(".rt-reader-page")?.getAttribute("data-paginated") === "true";
    const elements = [
      ...root.querySelectorAll(
        ".rt-reader-page, .rt-reader-book-title, .rt-reader-book-meta, .rt-reader-topline, .rt-reader-chapter, .rt-reader-header-label, .rt-reader-moon, .rt-reader-viewport, .rt-reader-bottomline, .rt-reader-clock, .rt-reader-percentage, .rt-reader-danmaku",
      ),
    ];
    if (!paginated) elements.push(...root.querySelectorAll(".rt-novel-excerpt__content, p"));
    return elements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const clippedTitle =
        root.getAttribute("data-variant") === "sfacg" &&
        element.matches(".rt-reader-book-title") &&
        style.overflowX === "hidden" &&
        style.textOverflow === "ellipsis";
      return rect.left < bounds.left - 1 ||
        rect.right > bounds.right + 1 ||
        (element.scrollWidth > element.clientWidth + 1 &&
          !element.matches(".rt-reader-viewport") &&
          !clippedTitle)
        ? [element.className]
        : [];
    });
  });
  expect(issues).toEqual([]);
  const sections = await excerpt.evaluate((root) => {
    const box = (selector: string) => root.querySelector(selector)!.getBoundingClientRect();
    const title = box(".rt-reader-book-title"),
      top = box(".rt-reader-topline"),
      body = box(".rt-reader-viewport"),
      footer = box(".rt-reader-bottomline"),
      paper = box(".rt-reader-page");
    return {
      footerTitle: root.getAttribute("data-variant") === "sfacg",
      titleStart: title.top,
      titleEnd: title.bottom,
      topStart: top.top,
      topEnd: top.bottom,
      bodyStart: body.top,
      bodyEnd: body.bottom,
      footerStart: footer.top,
      footerEnd: footer.bottom,
      paperEnd: paper.bottom,
    };
  });
  if (sections.footerTitle) {
    expect(sections.titleStart).toBeGreaterThanOrEqual(sections.footerStart - 1);
    expect(sections.titleEnd).toBeLessThanOrEqual(sections.footerEnd + 1);
  } else expect(sections.titleEnd).toBeLessThanOrEqual(sections.topStart + 1);
  expect(sections.topEnd).toBeLessThanOrEqual(sections.bodyStart + 1);
  expect(sections.bodyEnd).toBeLessThanOrEqual(sections.footerStart + 1);
  expect(sections.footerEnd).toBeLessThanOrEqual(sections.paperEnd + 1);
  expect(sections.bodyStart - sections.topEnd).toBeLessThanOrEqual(32);
  expect(sections.footerStart - sections.bodyEnd).toBeGreaterThan(0);
  expect(sections.footerStart - sections.bodyEnd).toBeLessThanOrEqual(32);
  const alignment = await excerpt.evaluate((root) => {
    const variant = root.getAttribute("data-variant");
    const box = (selector: string) => root.querySelector(selector)!.getBoundingClientRect();
    const clock = box(".rt-reader-clock"),
      footer = box(".rt-reader-bottomline");
    const center = (rect: DOMRect) => (rect.top + rect.bottom) / 2;
    if (variant === "sfacg") {
      const meta = box(".rt-reader-book-meta"),
        title = box(".rt-reader-book-title"),
        percentage = box(".rt-reader-percentage");
      const moon = box(".rt-reader-moon"),
        chapter = box(".rt-reader-chapter"),
        top = box(".rt-reader-topline");
      return {
        ordered:
          clock.right <= meta.left + 1 &&
          title.right <= percentage.left + 1 &&
          chapter.right <= moon.left + 1,
        centered:
          Math.abs(center(clock) - center(meta)) <= 1 && Math.abs(center(moon) - center(top)) <= 1,
        aligned:
          Math.abs(clock.left - footer.left) <= 1 &&
          Math.abs(meta.right - footer.right) <= 1 &&
          Math.abs((chapter.left + chapter.right - top.left - top.right) / 2) <= 1,
      };
    }
    if (variant === "ciweimao") {
      const progress = box(".rt-reader-progress"),
        danmaku = box(".rt-reader-danmaku");
      return {
        ordered: progress.right <= danmaku.left + 1 && danmaku.right <= clock.left + 1,
        centered:
          Math.abs(center(progress) - center(danmaku)) <= 1 &&
          Math.abs(center(danmaku) - center(clock)) <= 1,
        aligned:
          Math.abs(progress.left - footer.left) <= 1 && Math.abs(clock.right - footer.right) <= 1,
      };
    }
    return { ordered: true, centered: true, aligned: true };
  });
  expect(alignment).toEqual({ ordered: true, centered: true, aligned: true });
  const paragraphGaps = await excerpt.evaluate((root) => {
    if (root.querySelector('.rt-reader-page[data-paginated="true"]')) return [];
    const paragraphs = [...root.querySelectorAll(".rt-novel-excerpt__content p")];
    return paragraphs.slice(1).map((paragraph, index) => {
      const previous = paragraphs[index]!;
      return {
        actual: paragraph.getBoundingClientRect().top - previous.getBoundingClientRect().bottom,
        expected: parseFloat(getComputedStyle(previous).marginBottom),
      };
    });
  });
  for (const gap of paragraphGaps) {
    expect(gap.actual).toBeGreaterThan(0);
    expect(Math.abs(gap.actual - gap.expected)).toBeLessThanOrEqual(1);
  }
}

async function saveAndRead(page: Page, isMobile: boolean) {
  await page.getByRole("button", { name: isMobile ? "发布" : "保存", exact: true }).click();
  await expect(page.getByText("正文已保存，可切换到阅读视图检查", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.reload();
  await page.goto("/read");
  await expect(page.locator("[contenteditable=true]")).toHaveCount(0);
}

async function assertSourceLink(page: Page, reader: Locator) {
  const link = reader.locator(".rt-reader-book-title a");
  await link.hover();
  await expect(link).toHaveCSS("text-decoration-line", "none");
  await link.focus();
  await expect(link).toHaveCSS("text-decoration-line", "none");
  await page
    .context()
    .route(source, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<title>摘录来源</title>原文" }),
    );
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
}

test("刺猬猫弹幕箭头在不同字体与小数字号下不溢出也不被裁切", async ({ page, isMobile }, info) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: isMobile ? 320 : 1440, height: isMobile ? 844 : 1000 });
  const { inserted } = await createExcerpt(page, isMobile, "ciweimao", paragraphs, info);
  const issues = await inserted.evaluate((root) => {
    const footer = root.querySelector<HTMLElement>(".rt-reader-bottomline")!;
    const label = root.querySelector<HTMLElement>(".rt-reader-danmaku")!;
    const arrow = root.querySelector<HTMLElement>(".rt-reader-chevron-up")!;
    const originalStyle = footer.getAttribute("style");
    const failures = [];
    try {
      // 覆盖不同系统字体及像素取整，直接旋转布局盒的旧实现会多出 2px。
      for (const font of ["Arial, sans-serif", "serif", "monospace"]) {
        for (const size of [9, 9.25, 9.875, 10.5, 11.125, 12]) {
          for (const spacing of [0, 0.2, 0.3]) {
            footer.style.fontFamily = font;
            footer.style.fontSize = size + "px";
            footer.style.letterSpacing = spacing + "px";
            const labelBox = label.getBoundingClientRect();
            const arrowBox = arrow.getBoundingClientRect();
            if (
              label.scrollWidth > label.clientWidth + 1 ||
              arrowBox.right > labelBox.right + 1 ||
              getComputedStyle(label).overflowX !== "visible" ||
              getComputedStyle(arrow).overflowX !== "visible"
            ) {
              failures.push({
                font,
                size,
                spacing,
                client: label.clientWidth,
                scroll: label.scrollWidth,
                arrowOverhang: arrowBox.right - labelBox.right,
              });
            }
          }
        }
      }
    } finally {
      if (originalStyle === null) footer.removeAttribute("style");
      else footer.setAttribute("style", originalStyle);
    }
    return failures;
  });
  expect(issues).toEqual([]);
  await assertLayout(page, inserted);
});

for (const { variant, name } of templates) {
  for (const native320 of [false, true]) {
    test(
      name + (native320 ? "原生窄屏320" : "") + "摘录长标题、生成时间与保存后阅读刷新",
      async ({ page, isMobile }, info) => {
        test.skip(native320 && !isMobile, "原生窄屏启动仅在移动端验收");
        test.setTimeout(90_000);
        await page.setViewportSize({
          width: isMobile ? (native320 ? 320 : 390) : 1440,
          height: isMobile ? 844 : 1000,
        });
        const { inserted, directory, time, documentId } = await createExcerpt(
          page,
          isMobile,
          variant,
          paragraphs,
          info,
        );
        await assertExcerpt(inserted, variant, paragraphs, time);
        await expect(inserted).toHaveAttribute("data-page-count", "1");
        await expect(inserted.locator(".rt-reader-progress")).toContainText("1/1");
        // 选中特效：光标进入摘录正文时给出主题色描边。
        await inserted.locator(".rt-novel-excerpt__content p").first().click();
        await expect(inserted).toHaveClass(/rt-novel-excerpt--active/);
        await expect(inserted).toHaveCSS("outline-style", "solid");
        await expect(inserted).toHaveCSS("outline-width", "2px");
        await expect(inserted).toHaveCSS("outline-color", "rgb(15, 118, 110)");
        await assertLayout(page, inserted);
        await screenshot(page, info, directory, "editor");
        await saveAndRead(page, isMobile);
        const reader = page.locator(".rt-novel-excerpt--" + variant);
        await assertExcerpt(reader, variant, paragraphs, time);
        await assertLayout(page, reader);
        await screenshot(page, info, directory, "reader");
        await page.reload();
        await assertExcerpt(reader, variant, paragraphs, time);
        await assertSourceLink(page, reader);
        await assertLayout(page, reader);
        expect(await page.evaluate(() => localStorage.getItem("ricetext:selected-document"))).toBe(
          documentId,
        );
        if (isMobile) {
          await page.setViewportSize({ width: 320, height: 844 });
          await assertLayout(page, reader);
          await screenshot(page, info, directory, "reader-320");
        }
      },
    );
  }
}

for (const { variant, name } of templates) {
  test(
    name + "移动端只读分页保留每个字符、实际进度并忽略选字和装饰",
    async ({ page, isMobile }, info) => {
      test.skip(!isMobile, "触摸分页仅在移动端验收");
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 390, height: 844 });
      const body = Array.from(
        { length: 14 },
        (_, i) =>
          "第" +
          (i + 1) +
          "段。" +
          paragraphs[i % paragraphs.length]! +
          "这段文字的结尾必须完整显示，翻页不能遗漏任何一行。",
      );
      const { inserted, directory, time } = await createExcerpt(page, true, variant, body, info);
      await expect(inserted).toHaveAttribute("data-page-count", "1");
      await expect(inserted.locator(".rt-reader-page")).not.toHaveAttribute(
        "data-paginated",
        "true",
      );
      await saveAndRead(page, true);
      const reader = page.locator(".rt-novel-excerpt--" + variant);
      const viewport = reader.locator(".rt-reader-viewport");
      await expect(reader.locator(".rt-reader-page")).toHaveAttribute("data-paginated", "true");
      await expect
        .poll(async () => Number(await reader.getAttribute("data-page-count")))
        .toBeGreaterThan(2);
      const count = Number(await reader.getAttribute("data-page-count"));
      const tap = async (right: boolean) => {
        const box = await viewport.boundingBox();
        expect(box).not.toBeNull();
        await viewport.tap({
          position: { x: box!.width * (right ? 0.88 : 0.12), y: box!.height * 0.48 },
        });
      };
      await expect(reader).toHaveAttribute("data-page-index", "0");
      await tap(false);
      await expect(reader).toHaveAttribute("data-page-index", "0");
      await screenshot(page, info, directory, "reader-first");
      await assertSourceLink(page, reader);
      await expect(reader).toHaveAttribute("data-page-index", "0");
      await reader.locator(".rt-reader-clock").tap();
      for (const decoration of await reader.locator(".rt-reader-moon, .rt-reader-danmaku").all()) {
        await decoration.tap();
        await expect(reader).toHaveAttribute("data-page-index", "0");
        await expect(reader.locator(".rt-reader-book-title a")).not.toBeFocused();
      }
      await expect(reader).toHaveAttribute("data-page-index", "0");
      await viewport.evaluate((element) => {
        const text = element.querySelector("p")!.firstChild!;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, Math.min(8, text.textContent!.length));
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await tap(true);
      await expect(reader).toHaveAttribute("data-page-index", "0");
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      await viewport.scrollIntoViewIfNeeded();
      const dragBox = await viewport.boundingBox();
      await page.mouse.move(dragBox!.x + dragBox!.width * 0.8, dragBox!.y + 25);
      await page.mouse.down();
      await page.mouse.move(dragBox!.x + dragBox!.width * 0.2, dragBox!.y + 25, { steps: 8 });
      await page.mouse.up();
      await expect(reader).toHaveAttribute("data-page-index", "0");
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      const seen = new Set<number>();
      let total = 0;
      const characterEvidence = new Map<
        number,
        {
          char: string;
          left: number;
          right: number;
          top: number;
          bottom: number;
          distance: number;
          page: number;
        }
      >();
      for (let index = 0; index < count; index++) {
        await expect(reader).toHaveAttribute("data-page-index", String(index));
        await assertProgress(reader, variant);
        await assertLayout(page, reader);
        const visible = await viewport.evaluate((root) => {
          const bounds = root.getBoundingClientRect();
          const walker = document.createTreeWalker(
            root.querySelector(".rt-novel-excerpt__content")!,
            NodeFilter.SHOW_TEXT,
          );
          const found: number[] = [],
            clipped: number[] = [];
          const evidence: {
            offset: number;
            char: string;
            left: number;
            right: number;
            top: number;
            bottom: number;
            distance: number;
          }[] = [];
          let offset = 0,
            node;
          while ((node = walker.nextNode())) {
            for (let i = 0; i < node.textContent!.length; i++, offset++) {
              if (!node.textContent![i]!.trim()) continue;
              const range = document.createRange();
              range.setStart(node, i);
              range.setEnd(node, i + 1);
              const rect = range.getBoundingClientRect();
              evidence.push({
                offset,
                char: node.textContent![i]!,
                left: rect.left - bounds.left,
                right: rect.right - bounds.right,
                top: rect.top - bounds.top,
                bottom: rect.bottom - bounds.bottom,
                distance: Math.abs((rect.left + rect.right - bounds.left - bounds.right) / 2),
              });
              if (rect.width && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1) {
                if (rect.top >= bounds.top - 2 && rect.bottom <= bounds.bottom + 2)
                  found.push(offset);
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
          if (!previous || item.distance < previous.distance)
            characterEvidence.set(item.offset, { ...item, page: index });
        }
        await expect(reader.locator(".rt-reader-progress")).toContainText(index + 1 + "/" + count);
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
      await assertProgress(reader, variant);
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
      await expect
        .poll(async () => Number(await reader.getAttribute("data-page-count")))
        .toBeGreaterThan(2);
      const resizedIndex = Number(await reader.getAttribute("data-page-index"));
      expect(resizedIndex).toBeGreaterThanOrEqual(0);
      expect(resizedIndex).toBeLessThan(Number(await reader.getAttribute("data-page-count")));
      await assertProgress(reader, variant);
      await assertLayout(page, reader);
      await page.reload();
      await expect(reader).toHaveAttribute("data-page-index", "0");
      await assertExcerpt(reader, variant, body, time);
    },
  );
}
