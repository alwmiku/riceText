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

test('阅读页是静态显示器并支持黑幕与间贴', async ({ page }) => {
  await page.goto('/read');
  await expect(page.getByRole('link', { name: /阅读/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(page.getByRole('toolbar')).toHaveCount(0);

  const spoiler = page.locator('[data-spoiler="true"]').first();
  await expect(spoiler).toHaveAttribute('aria-expanded', 'false');
  await spoiler.click();
  await expect(spoiler).toHaveAttribute('aria-expanded', 'true');

  await page.locator('.rt-inline-comment-anchor').first().click();
  await expect(page.getByRole('dialog', { name: '段落间贴' })).toBeVisible();
});

test('作者编辑后通过 revision 自动保存', async ({ page }) => {
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
