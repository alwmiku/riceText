import { expect, test } from '@playwright/test';

test('三种编辑布局共用同一正文', async ({ page }) => {
  await page.goto('/compose');
  await expect(page.getByRole('heading', { name: '发帖与创作工作台' })).toBeVisible();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  const initialText = await editor.textContent();

  await page.getByRole('button', { name: /极简/ }).click();
  await expect(page.getByRole('button', { name: '发布回复' })).toBeVisible();
  await expect(page.locator('.ProseMirror')).toContainText((initialText ?? '').slice(0, 6));

  await page.getByRole('button', { name: /完整/ }).click();
  await expect(page.getByRole('toolbar', { name: '富文本工具栏' })).toBeVisible();

  await page.getByRole('button', { name: /移动/ }).click();
  await expect(page.getByRole('button', { name: '更多工具' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('阅读页是静态显示器并支持黑幕与间贴', async ({ page, isMobile }) => {
  await page.goto('/read');
  await expect(page.getByRole('link', { name: /阅读/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(page.getByRole('toolbar')).toHaveCount(0);

  // 间贴：第一章正文的评论计数气泡。
  await page.locator('.rt-inline-comment-anchor').first().click();
  await expect(page.getByRole('dialog', { name: '段落间贴' })).toBeVisible();
  await page.getByRole('button', { name: '关闭' }).click();

  // 黑幕：剧透文本位于第三章，先通过目录切换过去；移动端隐藏目录导航，跳过。
  if (!isMobile) {
    await page.getByRole('button', { name: /第三章.*没有寄件人的信/ }).click();
    const spoiler = page.locator('[data-spoiler="true"]').first();
    await expect(spoiler).toHaveAttribute('aria-expanded', 'false');
    await spoiler.click();
    await expect(spoiler).toHaveAttribute('aria-expanded', 'true');
  }
});

test('作者编辑后通过 revision 自动保存', async ({ page, isMobile }) => {
  // 两个 worker 并行保存同一演示文档会产生 revision 竞争；流程与布局无关，仅桌面验证。
  test.skip(isMobile, '自动保存流程与布局无关，移动端跳过以避免并行保存竞争');
  await page.goto('/compose');
  const status = page.locator('.save-status');
  await expect(status).toContainText('已保存');
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' 自动保存验收');
  await expect(status).toContainText(/正在保存|等待保存/);
  await expect(status).toContainText('已保存', { timeout: 10_000 });
});

test('长文本原文对照基于 pretext 测量与 react-window 虚拟滚动', async ({ page, isMobile }) => {
  test.skip(isMobile, '长文本工作台为桌面三栏布局，移动端不在本次验收范围');
  // 第一章正文 3000 字：跨越 2 个虚拟块，章尾可滚动离开首屏。
  const fixture = `第一章 起点\n${'这'.repeat(3000)}\n\n第二章 远行\n第二章正文。`;

  await page.goto('/compose');
  await page.getByRole('button', { name: '长文本' }).click();
  await page.getByLabel('导入长文本文件').setInputFiles({
    name: 'novel.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(fixture, 'utf8'),
  });

  const panel = page.getByLabel('原文对照');
  await expect(panel).toBeVisible();
  await expect(page.getByText('原文对照（虚拟滚动）')).toBeVisible();
  await expect(page.getByText(/已加载原文 3,022 字 · 共 2 块/)).toBeVisible();
  // 切分器把换行符计入下一章标题行，故第一章区间为 [0, 3,008)。
  await expect(page.getByText(/▼ 第 1 章「第一章 起点」开始 \[0, 3,008\)/)).toBeVisible();
  await expect(page.getByText('▲ 第 1 章结束')).toBeVisible();

  const area = page.getByLabel('完整原文滚动区');
  await expect(area).toContainText('这这这');

  // 章尾：结束标记所在行被渲染且滚动区下移。
  await page.getByRole('button', { name: '章尾' }).click();
  await expect(page.getByText('▲ 第 1 章结束')).toBeVisible();
  await expect
    .poll(() => area.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);

  // 章首：回到顶部。
  await page.getByRole('button', { name: '章首' }).click();
  await expect
    .poll(() => area.evaluate((el) => el.scrollTop))
    .toBeLessThanOrEqual(1);
});
