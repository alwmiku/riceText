import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../app-context';
import { defaultDocument, identities, seedComments, seedSuggestions } from '../lib/seed';
import { formatTime } from '../lib/utils';
import type { DocumentEnvelope, SeedIdentity } from '../lib/types';
import ReadPage from './ReadPage';

const mocks = vi.hoisted(() => ({
  getCommentThread: vi.fn(),
  getDocument: vi.fn(),
  listForumChapters: vi.fn(),
  listSuggestionBatches: vi.fn(),
  listSuggestions: vi.fn(),
  reviewSuggestionBatch: vi.fn(),
  reviewSuggestion: vi.fn(),
  submitSuggestionBatch: vi.fn(),
  submitSuggestion: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  getCommentThread: mocks.getCommentThread,
  getDocument: mocks.getDocument,
  listForumChapters: mocks.listForumChapters,
  listSuggestionBatches: mocks.listSuggestionBatches,
  listSuggestions: mocks.listSuggestions,
  reviewSuggestionBatch: mocks.reviewSuggestionBatch,
  reviewSuggestion: mocks.reviewSuggestion,
  submitSuggestionBatch: mocks.submitSuggestionBatch,
  submitSuggestion: mocks.submitSuggestion,
}));
vi.mock('../features/comments/CommentThread', () => ({
  CommentThread: (props: { initial: readonly unknown[]; identity: SeedIdentity }) => <div>回复树：{props.initial.length} 条 · {props.identity.name}</div>,
}));

const interactiveDocument: DocumentEnvelope = {
  ...defaultDocument,
  savedAt: '2026-08-20T08:30:00.000Z',
  content: {
    ...defaultDocument.content,
    content: [
      ...(defaultDocument.content.content ?? []),
      { type: 'paragraph', content: [{ type: 'mention', attrs: { userId: 'user_reader', name: '晚风翻页', resolved: true, avatarUrl: null } }] },
      { type: 'attachmentRef', attrs: { attachmentId: 'asset_paid', name: '章节资料.zip', mimeType: 'application/zip', size: 2048, priceCoins: 20 } },
      {
        type: 'pollRef',
        attrs: {
          pollId: 'poll_read',
          question: '下一章视角',
          multiple: false,
          options: [{ id: 'keeper', label: '守塔人' }, { id: 'postman', label: '邮差' }],
        },
      },
    ],
  },
};

function renderPage(identity: SeedIdentity, initialPath = '/read') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><AppContext.Provider value={{ identity, setIdentity: vi.fn() }}>{children}</AppContext.Provider></QueryClientProvider>;
  return render(<MemoryRouter initialEntries={[initialPath]}><ReadPage /></MemoryRouter>, { wrapper });
}

describe('ReadPage', () => {
  beforeEach(() => {
    mocks.getDocument.mockReset().mockResolvedValue(interactiveDocument);
    mocks.getCommentThread.mockReset().mockResolvedValue(seedComments);
    mocks.listForumChapters.mockReset().mockResolvedValue([]);
    mocks.listSuggestionBatches.mockReset().mockResolvedValue([]);
    mocks.listSuggestions.mockReset().mockResolvedValue(seedSuggestions);
    mocks.reviewSuggestionBatch.mockReset();
    mocks.reviewSuggestion.mockReset();
    mocks.submitSuggestionBatch.mockReset();
  });

  it('作者可取得付费附件但不会在阅读器自动看到回复可见正文，本地环境允许作者参与投票', async () => {
    renderPage(identities[0]!);
    expect(await screen.findByText('章节资料.zip')).toBeInTheDocument();
    expect(screen.queryByText(/日志坐标/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回复主题后显示本段航海日志。' })).toBeInTheDocument();
    expect(screen.getByText('@晚风翻页')).toBeInTheDocument();

    const attachment = screen.getByText('章节资料.zip').closest('button')!;
    expect(attachment).toHaveTextContent('购买 · 20');
    fireEvent.click(attachment);
    expect(screen.getByText('章节资料.zip').closest('button')).toHaveTextContent('下载');

    // 本地环境刻意让所有身份都可投票（见 ReadPage getPollState 注释），作者也不例外。
    expect(screen.getByRole('button', { name: /守塔人.*28 票/ })).toBeEnabled();
  });

  it('读者可请求解锁、打开间贴并参与单选投票', async () => {
    renderPage(identities[1]!);
    expect(await screen.findByText('章节资料.zip')).toBeInTheDocument();
    expect(screen.queryByText(/日志坐标/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '回复主题后显示本段航海日志。' }));
    expect(screen.getByRole('dialog', { name: '段落间贴' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.getCommentThread).toHaveBeenCalledWith('demo-post', 'thread_1'));
    expect(await screen.findByText('回复树：2 条 · 晚风翻页')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    const keeper = screen.getByRole('button', { name: /守塔人.*28 票/ });
    expect(keeper).toBeEnabled();
    fireEvent.click(keeper);
    expect(screen.getByRole('button', { name: /守塔人.*28 票/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /邮差.*19 票/ }));
    expect(screen.getByRole('button', { name: /守塔人.*28 票/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /邮差.*19 票/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('点击正文间贴气泡与侧栏入口均加载回复树', async () => {
    renderPage(identities[2]!);
    await screen.findByText('章节资料.zip');

    fireEvent.click(screen.getByRole('button', { name: '打开间贴: 6' }));
    expect(screen.getByRole('dialog', { name: '段落间贴' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: /本章间贴/ }));
    expect(screen.getByRole('dialog', { name: '段落间贴' })).toBeInTheDocument();
  });

  it('金币不足时不会把付费附件标记为已拥有', async () => {
    renderPage({ ...identities[1]!, coins: 5 });
    const attachment = (await screen.findByText('章节资料.zip')).closest('button')!;
    fireEvent.click(attachment);
    expect(screen.getByText('章节资料.zip').closest('button')).toHaveTextContent('购买 · 20');
  });

  it('作者可点击开始校订，进入字级 diff 视图并显示文章/章节/行定位', async () => {
    renderPage(identities[0]!);
    await screen.findByText('章节资料.zip');
    await waitFor(() => expect(mocks.listSuggestions).toHaveBeenCalledWith('demo-post', expect.anything()));

    // 右侧卡片显示“哪篇文章的哪个章节的哪些行”
    expect(screen.getByText('校订定位')).toBeInTheDocument();
    expect(screen.getByText(/文章《雾港来信：第三章讨论与校订》/)).toBeInTheDocument();
    expect(screen.getByText(/本章 4 处校订 · 涉及行 2、4、5、6/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '开始校订' }));
    expect(
      await screen.findByRole('region', { name: '校订对比视图' }),
    ).toBeInTheDocument();
    expect(screen.getByText('校订《雾港来信：第三章讨论与校订》· 正文')).toBeInTheDocument();
    // 字级 diff：只有变化的“正”→“恰”被高亮，公共字“好”保持普通
    const deleted = document.querySelector('[data-diff="delete"]');
    expect(deleted?.textContent).toBe('正');
    const inserted = document.querySelector('[data-diff="insert"]');
    expect(inserted?.textContent).toBe('恰');
    // 未变化上下文与修改片段同排混排
    expect(document.body.textContent).toContain('潮声越过旧防波堤时，灯塔');
    expect(document.body.textContent).toContain('熄灭');

    // 页头与视图内各有一个退出入口，点击任意一个都会退出
    fireEvent.click(screen.getAllByRole('button', { name: '退出校订' })[0]!);
    expect(screen.queryByRole('region', { name: '校订对比视图' })).not.toBeInTheDocument();
  });

  it('版主同样可以进入校订视图', async () => {
    renderPage(identities[2]!);
    await screen.findByText('章节资料.zip');
    fireEvent.click(await screen.findByRole('button', { name: '开始校订' }));
    expect(
      await screen.findByRole('region', { name: '校订对比视图' }),
    ).toBeInTheDocument();
  });

  it('头部时间与版本号匹配当前章节的真实数据，标题由正文自带', async () => {
    const chapterDoc: DocumentEnvelope = {
      ...defaultDocument,
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2, chapterStart: true },
            content: [{ type: 'text', text: '第一章 潮汐表' }],
          },
          { type: 'paragraph', content: [{ type: 'text', text: '正文一' }] },
          {
            type: 'heading',
            attrs: { level: 2, chapterStart: true },
            content: [{ type: 'text', text: '第二章 陌生船票' }],
          },
          { type: 'paragraph', content: [{ type: 'text', text: '正文二' }] },
        ],
      },
    };
    mocks.getDocument.mockResolvedValueOnce(chapterDoc);
    mocks.listForumChapters.mockResolvedValueOnce([
      {
        id: 'chapter-0',
        title: '第一章 潮汐表',
        order: 0,
        documentId: 'demo-post',
        revision: 6,
        savedAt: '2026-09-02T01:08:00.000Z',
        hidden: false,
      },
      {
        id: 'chapter-1',
        title: '第二章 陌生船票',
        order: 1,
        documentId: 'demo-post',
        revision: 3,
        savedAt: '2026-08-30T10:00:00.000Z',
        hidden: false,
      },
    ]);
    renderPage(identities[1]!, '/read?chapter=0');
    // 章节标题由正文自带（H2），头部不再重复。
    expect(
      await screen.findByRole('heading', { name: '第一章 潮汐表', level: 2 }),
    ).toBeInTheDocument();
    // 时间与版本号 = 该章在服务器目录中的真实数据。
    expect(screen.getByText('版本 6')).toBeInTheDocument();
    expect(
      screen.getByText(formatTime('2026-09-02T01:08:00.000Z')),
    ).toBeInTheDocument();
  });

  it('读者看不到已隐藏章节（目录与正文都移除）', async () => {
    mocks.listForumChapters.mockResolvedValueOnce([
      {
        id: 'chapter-0',
        title: '正文',
        order: 0,
        documentId: 'demo-post',
        revision: 1,
        savedAt: '2026-08-20T08:00:00.000Z',
        hidden: true,
      },
    ]);
    renderPage(identities[1]!);
    await waitFor(() =>
      expect(
        screen.queryByRole('navigation', { name: '章节目录' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('作者仍可预览与校订已隐藏章节', async () => {
    mocks.listForumChapters.mockResolvedValueOnce([
      {
        id: 'chapter-0',
        title: '正文',
        order: 0,
        documentId: 'demo-post',
        revision: 1,
        savedAt: '2026-08-20T08:00:00.000Z',
        hidden: true,
      },
    ]);
    renderPage(identities[0]!);
    await waitFor(() =>
      expect(
        screen.getByRole('navigation', { name: '章节目录' }),
      ).toBeInTheDocument(),
    );
  });
});
