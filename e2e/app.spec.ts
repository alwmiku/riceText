import { expect, test } from '@playwright/test';

test('三种编辑布局共用同一正文', async ({ page }) => {
  // 固定演示文章，避免继承前序用例创建文章后的默认排序。
  await page.addInitScript(() => {
    localStorage.setItem('ricetext:selected-document', 'demo-post');
  });
  await page.goto('/compose');
  // 首次访问会懒加载编辑器路由及其依赖；仅为工作区启动预留冷编译时间。
  await expect(page.getByRole('heading', { name: '发帖与创作工作台' })).toBeVisible({ timeout: 20_000 });
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(editor).not.toHaveText('');
  const initialText = (await editor.textContent())!;

  await page.getByRole('button', { name: /极简/ }).click();
  await expect(page.getByRole('button', { name: '发布回复' })).toBeVisible();
  await expect(editor).toHaveText(initialText);

  await page.getByRole('button', { name: /完整/ }).click();
  await expect(page.getByRole('toolbar', { name: '富文本工具栏' })).toBeVisible();
  await expect(editor).toHaveText(initialText);

  await page.getByRole('button', { name: /移动/ }).click();
  await expect(page.getByRole('button', { name: '更多工具' })).toBeVisible();
  await expect(editor).toHaveText(initialText);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('阅读页是静态显示器并支持黑幕与间贴', async ({ page, isMobile }) => {
  // 间贴/黑幕节点在「雾港来信 · 第一章」（demo-post）的文档正文里：占位目录行
  // 没有正文，阅读页会回退到文档正文渲染。这里用 localStorage 预选文章，
  // 移动端没有可见的文章选择器也能生效。
  await page.addInitScript(() => {
    localStorage.setItem('ricetext:selected-document', 'demo-post');
  });
  await page.goto('/read');
  await expect(page.getByRole('link', { name: /阅读/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(page.getByRole('toolbar')).toHaveCount(0);
  await expect(page.locator('.rt-inline-comment-anchor').first()).toBeVisible();

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

test('作者编辑先自动保存本地，点击保存后才上传最小 revision', async ({ page, isMobile }) => {
  // 两个 worker 并行保存同一文档会产生 revision 竞争；流程与布局无关，仅桌面验证。
  test.skip(isMobile, '保存流程与布局无关，移动端跳过以避免并行保存竞争');
  // 默认文章可能是分章上传的长文本（正文走章节缓存、无本地自动保存），
  // 用「雾港来信 · 第一章」（demo-post）跑服务器最小 revision 的保存验收。
  await page.addInitScript(() => {
    localStorage.setItem('ricetext:selected-document', 'demo-post');
  });
  await page.goto('/compose');
  const status = page.locator('.save-status');
  await expect(status).toContainText('已保存到服务器');
  // 等待服务器真实 revision 渲染完成（占位文档也是 v0 起步，避免读数竞态）。
  await expect(status).toHaveText(/已保存到服务器 · v[1-9]\d*/);
  const initialStatus = await status.textContent();
  const initialRevision = initialStatus?.match(/v\d+/)?.[0] ?? "";
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' 本地自动保存验收');
  await expect(status).toContainText('等待保存');
  await expect(status).toContainText('已自动保存到本地', { timeout: 10_000 });
  expect(await status.textContent()).toContain(initialRevision);

  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(status).toContainText('已保存到服务器', { timeout: 10_000 });
  expect(await status.textContent()).not.toBe(initialStatus);
});

test('移动端向下阅读时收起页头，向上滚动时恢复', async ({ page, isMobile }) => {
  test.skip(!isMobile, '仅验证移动端页头滚动行为');
  // 目录与校订数据来自同一篇演示文章；不能继承前序用例新建文章的默认排序。
  await page.addInitScript(() => {
    localStorage.setItem('ricetext:selected-document', 'demo-post');
    localStorage.setItem('ricetext:active-chapter:demo-post', '3');
  });
  await page.goto('/compose');
  await expect(page.locator('.ProseMirror h2')).toHaveText('第三章 没有寄件人的信');
  const header = page.getByRole('banner');
  const directory = page.getByRole('button', { name: '打开章节目录' });
  await expect(directory).toBeVisible();
  await expect(header).toHaveAttribute('data-hidden', 'false');
  await page.evaluate(() => {
    document.body.style.minHeight = '3000px';
    window.scrollTo(0, 520);
  });
  await expect(header).toHaveAttribute('data-hidden', 'true');
  await expect(directory).toBeVisible();
  await directory.click();
  const mobileSidebar = page.getByRole('dialog', { name: '章节目录' });
  await expect(mobileSidebar).toBeVisible();
  const chapterRail = mobileSidebar.getByRole('complementary', { name: '章节目录' });
  const creativeTools = mobileSidebar.getByRole('complementary', { name: '创作业务面板' });
  await expect(chapterRail).toBeVisible();
  await expect(creativeTools.getByText('创作工具')).toBeVisible();
  await expect(creativeTools.getByRole('button', { name: '校订' })).toBeVisible();
  await expect(creativeTools.getByRole('tablist', { name: '校订状态' })).toBeVisible();
  const location = creativeTools.getByLabel('校订位置');
  await location.scrollIntoViewIfNeeded();
  const locationRows = location.locator('dd');
  await expect(locationRows).toHaveCount(3);
  await expect(locationRows.nth(0)).toHaveText('第三章 · 没有寄件人的信');
  await expect(locationRows.nth(1)).toHaveText('第 3 行');
  const rowTops = await locationRows.evaluateAll((rows) =>
    rows.map((row) => row.getBoundingClientRect().top),
  );
  expect(rowTops[1]).toBeGreaterThan(rowTops[0]!);
  expect(rowTops[2]).toBeGreaterThan(rowTops[1]!);
  await expect
    .poll(() =>
      mobileSidebar.evaluate((sidebar) => {
        const rail = sidebar.querySelector('[aria-label="章节目录"]');
        const tools = sidebar.querySelector('[aria-label="创作业务面板"]');
        return Boolean(
          rail &&
            tools &&
            rail.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
    )
    .toBe(true);
  // 抽屉内容会因业务面板轮询而持续微动，关闭按钮的稳定性等待无法收敛；
  // 点击抽屉右侧的遮罩关闭（不是关闭按钮本身）。
  await page.mouse.click(370, 400);
  await expect(page.getByRole('dialog', { name: '章节目录' })).toBeHidden();
  await expect
    .poll(() => header.evaluate((element) => element.getBoundingClientRect().bottom))
    .toBeLessThanOrEqual(1);

  await page.evaluate(() => window.scrollTo(0, 300));
  await expect(header).toHaveAttribute('data-hidden', 'false');
});

test('移动端选择正文后显示浮动修订入口', async ({ page, isMobile }) => {
  test.skip(!isMobile, '仅验证移动端 selectionchange 与浮动操作入口');
  await page.addInitScript(() => {
    localStorage.setItem('ricetext:identity', 'user_reader');
    localStorage.setItem('ricetext:selected-document', 'demo-post');
  });
  await page.goto('/read');
  const readDirectory = page.getByRole('button', { name: '打开章节目录', exact: true });
  await expect(readDirectory).toBeVisible();
  await readDirectory.click();
  const readingDirectory = page.getByRole('dialog', { name: '阅读章节目录' });
  await expect(readingDirectory).toBeVisible();
  // 阅读页不使用编辑页的章节键；通过目录选中含“潮声”的第一章。
  await readingDirectory.getByRole('button', { name: /第一章.*潮汐表/ }).click();
  await expect(readingDirectory).toBeHidden();
  await expect(page.locator('.rt-viewer .ProseMirror h2')).toHaveText('第一章 潮汐表');
  await readDirectory.click();
  await expect(readingDirectory).toBeVisible();
  await readingDirectory.getByRole('button', { name: '关闭阅读目录', exact: true }).click();
  const paragraph = page.locator('.rt-viewer .ProseMirror p').filter({ hasText: '潮声' }).first();
  await expect(paragraph).toBeVisible();
  await paragraph.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.textContent?.includes('潮声')) node = walker.nextNode();
    if (!node?.textContent) throw new Error('未找到可选择的潮声文本');
    const start = node.textContent.indexOf('潮声');
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + 2);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });

  const action = page.getByRole('button', { name: '提交所选文字修订：潮声' });
  await expect(action).toBeVisible();
  const actionGeometry = await action.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      bottomGap: window.innerHeight - rect.bottom,
      horizontalGap: window.innerWidth - rect.width,
    };
  });
  expect(actionGeometry.bottomGap).toBeLessThanOrEqual(24);
  expect(actionGeometry.horizontalGap).toBeLessThanOrEqual(40);
  await action.click();
  await expect(page.getByRole('dialog', { name: '提交修订' })).toBeVisible();
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
