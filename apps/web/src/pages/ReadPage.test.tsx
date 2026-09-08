import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../app-context';
import { defaultDocument, identities, seedComments, seedSuggestions } from '../lib/seed';
import { formatTime } from '../lib/utils';
import type { DocumentEnvelope, ForumChapterItem, SeedIdentity } from '../lib/types';
import { chapterQueryKeys } from '../lib/chapter-query-keys';
import ReadPage from './ReadPage';

const mocks = vi.hoisted(() => ({
  getCommentThread: vi.fn(),
  getDocument: vi.fn(),
  getLongTextChapter: vi.fn(),
  listForumChapters: vi.fn(),
  listDocuments: vi.fn(),
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
  getLongTextChapter: mocks.getLongTextChapter,
  missingDocument: (id: string) => ({
    id,
    title: '未命名文章',
    schemaVersion: 1,
    revision: 0,
    savedAt: new Date(0).toISOString(),
    content: { type: 'doc', content: [] },
    storage: 'missing',
  }),
  listForumChapters: mocks.listForumChapters,
  listDocuments: mocks.listDocuments,
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
  localStorage.setItem('ricetext:selected-document', 'demo-post');
  mocks.listDocuments.mockResolvedValue([
    {
      id: 'demo-post',
      title: interactiveDocument.title,
      revision: interactiveDocument.revision,
      savedAt: interactiveDocument.savedAt,
      canEdit: identity.role !== 'reader',
    },
  ]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><AppContext.Provider value={{ identity, setIdentity: vi.fn(), authMode: "demo", authStatus: "authenticated", login: vi.fn(), logout: vi.fn(async () => undefined), refreshIdentity: vi.fn(async () => undefined) }}>{children}</AppContext.Provider></QueryClientProvider>;
  return { ...render(<MemoryRouter initialEntries={[initialPath]}><ReadPage /></MemoryRouter>, { wrapper }), client };
}

describe('ReadPage', () => {
  beforeEach(() => {
    mocks.getDocument.mockReset().mockResolvedValue(interactiveDocument);
    mocks.getLongTextChapter.mockReset().mockResolvedValue({
      id: "chapter-0",
      title: "正文",
      order: 0,
      documentId: "demo-post",
      revision: 1,
      savedAt: interactiveDocument.savedAt,
      hidden: false,
      content: interactiveDocument.content,
    });
    mocks.getCommentThread.mockReset().mockResolvedValue(seedComments);
    mocks.listForumChapters.mockReset().mockResolvedValue([]);
    mocks.listDocuments.mockReset().mockResolvedValue([
      {
        id: 'demo-post',
        title: interactiveDocument.title,
        revision: interactiveDocument.revision,
        savedAt: interactiveDocument.savedAt,
        canEdit: true,
      },
    ]);
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
    mocks.getLongTextChapter.mockResolvedValueOnce({
      id: 'chapter-0',
      title: '第一章 潮汐表',
      order: 0,
      documentId: 'demo-post',
      revision: 6,
      savedAt: '2026-09-02T01:08:00.000Z',
      hidden: false,
      content: {
        type: 'doc',
        content: chapterDoc.content.content?.slice(0, 2) ?? [],
      },
    });
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
    renderPage(identities[1]!);
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

  it('主文档为空时按正文存在标记读取版本 0 的分章正文和目录', async () => {
    mocks.getDocument.mockResolvedValueOnce({
      ...interactiveDocument,
      content: { type: 'doc', content: [] },
    });
    mocks.listForumChapters.mockResolvedValueOnce([
      {
        id: 'uploaded-chapter',
        title: '上传章节',
        order: 0,
        documentId: 'demo-post',
        revision: 0,
        hasContent: true,
        savedAt: '2026-09-03T09:00:00.000Z',
        hidden: false,
      },
    ]);
    mocks.getLongTextChapter.mockResolvedValueOnce({
      id: 'uploaded-chapter',
      title: '上传章节',
      order: 0,
      documentId: 'demo-post',
      revision: 0,
      savedAt: '2026-09-03T09:00:00.000Z',
      hidden: false,
      content: {
        type: 'doc',
        content: [
          {
            type: 'longTextBlock',
            attrs: {
              chapterId: 'uploaded-chapter',
              title: '上传章节',
              text: '这是已经分章上传的正文。',
              order: 0,
            },
          },
        ],
      },
    });

    renderPage(identities[1]!, '/read?chapter=0');

    expect(
      await screen.findByText('这是已经分章上传的正文。'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '打开章节目录' }),
    ).toBeInTheDocument();
    expect(mocks.getLongTextChapter).toHaveBeenCalledWith(
      'demo-post',
      'uploaded-chapter',
      expect.anything(),
    );
  });

  it('读者的正文和目录请求都绑定当前文章 ID', async () => {
    renderPage(identities[1]!);
    await waitFor(() =>
      expect(mocks.getDocument).toHaveBeenCalledWith('demo-post', expect.anything()),
    );
    await waitFor(() =>
      expect(mocks.listForumChapters).toHaveBeenCalledWith('demo-post', { strict: true }),
    );
  });

  it('占位章保留文档派生正文且不请求不存在的独立正文', async () => {
    mocks.listForumChapters.mockResolvedValue([{
      id: 'legacy-stable', documentId: 'demo-post', title: '正文', order: 0,
      revision: 8, hasContent: false, hidden: false, savedAt: interactiveDocument.savedAt,
    }]);
    renderPage(identities[1]!);
    expect(await screen.findByText('章节资料.zip')).toBeInTheDocument();
    expect(mocks.getLongTextChapter).not.toHaveBeenCalled();
  });

  it('独立正文失败显示重试且不泄露同位置的文档内容', async () => {
    mocks.listForumChapters.mockResolvedValue([{
      id: 'uploaded', documentId: 'demo-post', title: '上传章节', order: 0,
      revision: 0, hasContent: true, hidden: false, savedAt: interactiveDocument.savedAt,
    }]);
    mocks.getLongTextChapter.mockRejectedValue(new Error('网络离线'));
    renderPage(identities[1]!);
    expect(await screen.findByRole('alert')).toHaveTextContent('章节加载失败');
    expect(screen.queryByText('章节资料.zip')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开始校订' })).not.toBeInTheDocument();
    mocks.getLongTextChapter.mockResolvedValue({
      id: 'uploaded', documentId: 'demo-post', content: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: '重试后的正确章节' }] },
      ] },
    });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('重试后的正确章节')).toBeInTheDocument();
  });

  it('空壳中的占位目录显示暂无正文且不挂载校订入口', async () => {
    mocks.getDocument.mockResolvedValue({ ...interactiveDocument, content: { type: 'doc', content: [] } });
    mocks.listForumChapters.mockResolvedValue([{
      id: 'empty', documentId: 'demo-post', title: '待写章节', order: 0,
      revision: 0, hasContent: false, hidden: false, savedAt: interactiveDocument.savedAt,
    }]);
    renderPage(identities[0]!);
    expect(await screen.findByText('本章暂无正文。')).toBeInTheDocument();
    expect(mocks.getLongTextChapter).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '开始校订' })).not.toBeInTheDocument();
  });

  it('目录重排后保持当前稳定章节及其正文与版本', async () => {
    const directory: ForumChapterItem[] = ['甲', '乙'].map((title, order) => ({
      id: 'stable-' + order, documentId: 'demo-post', title, order,
      revision: order + 1, hasContent: true, hidden: false, savedAt: interactiveDocument.savedAt,
    }));
    mocks.listForumChapters.mockResolvedValue(directory);
    mocks.getLongTextChapter.mockImplementation(async (_documentId: string, id: string) => ({
      ...directory.find((chapter) => chapter.id === id),
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: id + '正文' }] }] },
    }));
    const { client } = renderPage(identities[1]!);
    await screen.findByText('stable-0正文');
    fireEvent.click(screen.getByRole('button', { name: '乙' }));
    await screen.findByText('stable-1正文');
    act(() => client.setQueryData(chapterQueryKeys.directory('demo-post'), [
      { ...directory[1]!, order: 0 }, { ...directory[0]!, order: 1 },
    ]));
    await waitFor(() => expect(screen.getByRole('button', { name: '乙' })).toHaveAttribute('aria-current', 'true'));
    expect(screen.getByText('stable-1正文')).toBeInTheDocument();
    expect(screen.getByText('版本 2')).toBeInTheDocument();
    expect(screen.queryByText('stable-0正文')).not.toBeInTheDocument();
  });

  it('校订入口的稳定章节ID优先于旧位置参数', async () => {
    mocks.getDocument.mockResolvedValue({ ...interactiveDocument, content: { type: 'doc', content: [] } });
    mocks.listForumChapters.mockResolvedValue([0, 1].map((order) => ({
      id: 'stable-' + order, documentId: 'demo-post', title: '章节' + order, order,
      revision: 0, hasContent: true, hidden: false, savedAt: interactiveDocument.savedAt,
    })));
    mocks.getLongTextChapter.mockImplementation(async (documentId: string, id: string) => ({
      documentId, id, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: id + '正文' }] }] },
    }));
    renderPage(identities[1]!, '/read?chapter=0&chapterId=stable-1');
    expect(await screen.findByText('stable-1正文')).toBeInTheDocument();
    expect(mocks.getLongTextChapter).not.toHaveBeenCalledWith('demo-post', 'stable-0', expect.anything());
  });

  it('目录失败不会被当作空目录并回退到文档正文', async () => {
    mocks.listForumChapters.mockRejectedValue(new Error('网络离线'));
    renderPage(identities[1]!);
    expect(await screen.findByRole('alert')).toHaveTextContent('章节加载失败');
    expect(screen.queryByText('章节资料.zip')).not.toBeInTheDocument();
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
