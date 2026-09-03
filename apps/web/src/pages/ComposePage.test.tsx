import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../app-context';
import { defaultDocument, identities } from '../lib/seed';
import type { DocumentEnvelope, RichTextNode, SaveState } from '../lib/types';
import ComposePage from './ComposePage';

const mocks = vi.hoisted(() => ({
  autosave: vi.fn(),
  createDocumentChapter: vi.fn(),
  deleteDocumentChapter: vi.fn(),
  flush: vi.fn(),
  getCommentThread: vi.fn(),
  getDocument: vi.fn(),
  getLongTextChapter: vi.fn(),
  listForumChapters: vi.fn(),
  listDocuments: vi.fn(),
  saveDocument: vi.fn(),
  restoreRevision: vi.fn(),
  getRevision: vi.fn(),
  setDocumentChapterHidden: vi.fn(),
  uploadLongTextChapter: vi.fn(),
}));

vi.mock('../features/editor/hooks/useAutosave', () => ({ useAutosave: mocks.autosave }));
vi.mock('../lib/api', () => ({
  createDocumentChapter: mocks.createDocumentChapter,
  deleteDocumentChapter: mocks.deleteDocumentChapter,
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
  restoreRevision: mocks.restoreRevision,
  saveDocument: mocks.saveDocument,
  setDocumentChapterHidden: mocks.setDocumentChapterHidden,
  uploadLongTextChapter: mocks.uploadLongTextChapter,
}));
vi.mock('../lib/api/revisions', () => ({
  getRevision: mocks.getRevision,
}));
vi.mock('../features/editor/RichTextEditor', () => ({
  RichTextEditor: (props: {
    content: RichTextNode;
    mode: string;
    editable?: boolean;
    onChange: (content: RichTextNode) => void;
    onSubmit?: (content: RichTextNode) => void;
    onReady?: (editor: null) => void;
    onExpand?: () => void;
    onCommentAnchorOpen?: (id: string) => void;
  }) => <section data-testid="editor" data-mode={props.mode} data-editable={String(props.editable)} data-content={JSON.stringify(props.content)}>
    <button type="button" onClick={() => props.onChange({ type: 'doc', content: [{ type: 'paragraph' }] })}>模拟编辑</button>
    <button type="button" onClick={() => props.onSubmit?.({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'submitted' }] }] })}>模拟发布</button>
    <button type="button" onClick={props.onExpand}>模拟展开</button>
    <button type="button" onClick={() => props.onCommentAnchorOpen?.('thread_1')}>模拟间贴锚点</button>
  </section>,
}));
vi.mock('../features/forum/ForumPanels', () => ({
  ChapterRail: (props: { chapters?: readonly unknown[]; currentIndex?: number; onSelect: (index: number) => void; onAddChapter?: () => void; createArticle?: boolean; onDelete?: (index: number) => void; className?: string }) => (
    <aside className={props.className} aria-label="章节目录" data-chapters={String(props.chapters?.length ?? 0)} data-active-index={String(props.currentIndex ?? 0)}>
      <span>模拟章节目录</span>
      <button type="button" onClick={() => props.onSelect(0)}>模拟章节 1</button>
      <button type="button" onClick={() => props.onAddChapter?.()}>{props.createArticle ? '创建文章' : '模拟新增章节'}</button>
      <button type="button" onClick={() => props.onDelete?.(0)}>模拟删除章节</button>
    </aside>
  ),
  ForumBusinessPanel: (props: { onRestore: (revision: number) => void; onCompare?: (revision: number) => void }) => <aside><span>模拟创作工具</span><button type="button" onClick={() => props.onCompare?.(17)}>模拟比较</button><button type="button" onClick={() => props.onRestore(17)}>模拟回退</button></aside>,
}));
vi.mock('../features/comments/CommentThread', () => ({
  CommentThread: (props: { initial: readonly unknown[] }) => <div>模拟回复树 {props.initial.length}</div>,
}));

function renderPage(
  identity = identities[0]!,
  authStatus: "authenticated" | "unauthenticated" = "authenticated",
  articles: Array<{
    id: string;
    title: string;
    revision: number;
    savedAt: string;
    canEdit: boolean;
  }> = [
    {
      id: 'demo-post',
      title: defaultDocument.title,
      revision: defaultDocument.revision,
      savedAt: defaultDocument.savedAt,
      canEdit: identity.role !== 'reader',
    },
  ],
) {
  localStorage.setItem('ricetext:selected-document', 'demo-post');
  mocks.listDocuments.mockResolvedValue(articles);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><AppContext.Provider value={{ identity, setIdentity: vi.fn(), authMode: authStatus === "authenticated" ? "demo" : "session", authStatus, login: vi.fn(), logout: vi.fn(async () => undefined), refreshIdentity: vi.fn(async () => undefined) }}>{children}</AppContext.Provider></QueryClientProvider>;
  return render(<MemoryRouter><ComposePage /></MemoryRouter>, { wrapper });
}

function autosaveValue(state: SaveState = 'saved') {
  return {
    state,
    revision: 18,
    savedAt: defaultDocument.savedAt,
    conflictMessage: state === 'conflict' ? '服务器版本已更新' : '',
    flush: mocks.flush,
    saveLocal: vi.fn(() => true),
    acceptSaved: vi.fn(),
    acceptLatest: vi.fn(),
  };
}

/** 带两个章节标记（chapterStart）的文档，供删除与章节位置用例使用。 */
const twoChapterDoc: DocumentEnvelope = {
  ...defaultDocument,
  storage: 'server',
  content: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '雾港来信' }] },
      { type: 'heading', attrs: { level: 2, chapterStart: true }, content: [{ type: 'text', text: '第一章 潮汐表' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '潮声沿着旧城墙漫上来。' }] },
      { type: 'heading', attrs: { level: 2, chapterStart: true }, content: [{ type: 'text', text: '第二章 陌生船票' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '他在抽屉底层找到一张陌生的船票。' }] },
    ],
  },
};

describe('ComposePage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false, media: '', addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
    window.localStorage.clear();
    mocks.autosave.mockReset().mockReturnValue(autosaveValue());
    mocks.createDocumentChapter.mockReset().mockImplementation(async (_documentId: string, input: { title: string; order: number }) => ({
      id: 'chapter-' + String(input.order),
      title: input.title,
      order: input.order,
      documentId: 'demo-post',
      revision: 0,
      savedAt: '2026-09-01T20:00:00.000Z',
    }));
    mocks.deleteDocumentChapter.mockReset().mockResolvedValue({ id: 'chapter-0', deleted: true });
    mocks.listForumChapters.mockReset().mockResolvedValue([]);
    mocks.listDocuments.mockReset().mockResolvedValue([
      {
        id: 'demo-post',
        title: defaultDocument.title,
        revision: defaultDocument.revision,
        savedAt: defaultDocument.savedAt,
        canEdit: true,
      },
    ]);
    mocks.saveDocument.mockReset();
    mocks.flush.mockReset().mockResolvedValue(true);
    mocks.getLongTextChapter.mockReset().mockResolvedValue(undefined);
    mocks.uploadLongTextChapter.mockReset().mockResolvedValue({ revision: 2 });
    mocks.getDocument.mockReset().mockResolvedValue({
      ...defaultDocument,
      storage: 'server',
    });
    mocks.getCommentThread.mockReset().mockResolvedValue([]);
    mocks.restoreRevision.mockReset().mockResolvedValue({ ...defaultDocument, revision: 19, savedAt: '2026-08-20T12:00:00.000Z' });
    mocks.getRevision.mockReset().mockResolvedValue({
      ...twoChapterDoc,
      revision: 17,
      content: {
        ...twoChapterDoc.content,
        content: twoChapterDoc.content.content?.map((node, index) =>
          index === 2
            ? { type: 'paragraph', content: [{ type: 'text', text: '旧潮声沿着城墙。' }] }
            : node,
        ),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('游客只得到空白本地编辑器，不请求服务器文章或章节', async () => {
    const guest = {
      id: 'anonymous',
      name: '未登录',
      role: 'reader' as const,
      avatar: '访',
      coins: 0,
      replied: false,
    };
    renderPage(guest, 'unauthenticated');
    expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'true');
    expect(mocks.listDocuments).not.toHaveBeenCalled();
    expect(mocks.getDocument).not.toHaveBeenCalled();
    expect(mocks.listForumChapters).not.toHaveBeenCalled();
    expect(screen.queryByRole('combobox', { name: '选择文章' })).not.toBeInTheDocument();
  });

  it('空库显示创建文章，点击后只创建可编辑的本地空白正文', async () => {
    mocks.getDocument.mockResolvedValue({
      id: 'demo-post',
      title: '未命名文章',
      schemaVersion: 1,
      revision: 0,
      savedAt: new Date(0).toISOString(),
      content: { type: 'doc', content: [] },
      storage: 'missing',
    });
    renderPage();
    const create = await screen.findByRole('button', { name: '创建文章' });
    expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'false');
    fireEvent.click(create);
    const dialog = screen.getByRole('dialog', { name: '新建文章' });
    fireEvent.change(within(dialog).getByLabelText('文章名称'), {
      target: { value: '第一篇文章' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }));
    await waitFor(() =>
      expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'true'),
    );
    expect(screen.getByRole('button', { name: '模拟新增章节' })).toBeInTheDocument();
    expect(screen.getByText('已在本地创建《第一篇文章》，点击保存后上传服务器')).toBeInTheDocument();
  });

  it('新建文章先填写名称，并把名称保存在对应本地草稿中', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '新文章' }));
    const dialog = screen.getByRole('dialog', { name: '新建文章' });
    fireEvent.change(within(dialog).getByLabelText('文章名称'), {
      target: { value: '我的第二篇文章' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '模拟新增章节' })).toBeInTheDocument(),
    );
    const draftId = localStorage.getItem('ricetext:selected-document')!;
    expect(draftId).toMatch(/^article_/);
    expect(localStorage.getItem(`ricetext:draft-title:${draftId}`)).toBe(
      '我的第二篇文章',
    );
  });

  it('切换完整、极简和移动布局，并从极简入口展开', async () => {
    renderPage();
    expect(screen.getByTestId('editor')).toHaveAttribute('data-mode', 'full');
    expect(screen.getByText('模拟章节目录')).toBeInTheDocument();
    expect(await screen.findByText('模拟创作工具')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '极简' }));
    expect(screen.getByTestId('editor')).toHaveAttribute('data-mode', 'compact');
    expect(screen.queryByText('模拟章节目录')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开' }));
    expect(screen.getByTestId('editor')).toHaveAttribute('data-mode', 'full');

    fireEvent.click(screen.getByRole('button', { name: '移动' }));
    expect(screen.getByTestId('editor')).toHaveAttribute('data-mode', 'mobile');
    expect(screen.getByText(/移动编辑/)).toBeInTheDocument();
  });

  it('移动编辑模式通过左侧抽屉切换章节', async () => {
    renderPage();
    await screen.findByText('模拟创作工具');

    fireEvent.click(screen.getByRole('button', { name: '移动' }));
    expect(screen.getByRole('button', { name: '打开章节目录' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开章节目录' }));
    const mobileSidebar = screen.getByRole('dialog', { name: '章节目录' });
    expect(mobileSidebar).toBeInTheDocument();
    expect(within(mobileSidebar).getByText('模拟创作工具')).toBeInTheDocument();

    const chapterRail = within(mobileSidebar).getByText('模拟章节目录');
    const creativeTools = within(mobileSidebar).getByText('模拟创作工具');
    expect(
      chapterRail.compareDocumentPosition(creativeTools) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '模拟章节 1' }));
    expect(screen.queryByRole('dialog', { name: '章节目录' })).not.toBeInTheDocument();
  });

  it('目录「新增章节」在文档末尾追加空章节并切换到新章节', async () => {
    // 用带一个 H2 章节的文档：追加后目录从 1 章变 2 章（web 演示种子没有 H2，
    // 追加会把旧内容归入 lead，不适合验证章节计数）。
    const chapterDoc: DocumentEnvelope = {
      ...defaultDocument,
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: '雾港来信' }],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: '第一章 潮汐表' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '潮声沿着旧城墙漫上来。' }],
          },
        ],
      },
    };
    mocks.getDocument.mockResolvedValueOnce(chapterDoc);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('editor')).toHaveAttribute(
        'data-editable',
        'true',
      ),
    );
    const rail = screen.getByRole('complementary', { name: '章节目录' });
    expect(rail).toHaveAttribute('data-chapters', '1');

    fireEvent.click(screen.getByRole('button', { name: '模拟新增章节' }));

    expect(rail).toHaveAttribute('data-chapters', '2');
    expect(screen.getByText(/已新增第 2 章/)).toBeInTheDocument();
  });

  it('目录「删除章节」移除对应章节并提示仅本地生效', async () => {
    mocks.getDocument.mockResolvedValueOnce(twoChapterDoc);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('editor')).toHaveAttribute(
        'data-editable',
        'true',
      ),
    );
    const rail = screen.getByRole('complementary', { name: '章节目录' });
    expect(rail).toHaveAttribute('data-chapters', '2');

    fireEvent.click(screen.getByRole('button', { name: '模拟删除章节' }));

    expect(rail).toHaveAttribute('data-chapters', '1');
    expect(
      screen.getByText(/已删除章节「第一章 潮汐表」/),
    ).toBeInTheDocument();
    // 目录行通过删除章节接口清理（幂等）。
    expect(mocks.deleteDocumentChapter).toHaveBeenCalledWith(
      'demo-post',
      'chapter-0',
    );
  });

  it('记住上次编辑的章节：刷新后仍停留在原章节（移动端）', async () => {
    window.localStorage.setItem('ricetext:active-chapter:demo-post', '1');
    mocks.getDocument.mockResolvedValueOnce(twoChapterDoc);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('editor')).toHaveAttribute(
        'data-editable',
        'true',
      ),
    );
    expect(
      screen.getByRole('complementary', { name: '章节目录' }),
    ).toHaveAttribute('data-active-index', '1');
  });

  it('切换章节后把当前位置写入本地存储', async () => {
    mocks.getDocument.mockResolvedValueOnce(twoChapterDoc);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('editor')).toHaveAttribute(
        'data-editable',
        'true',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '模拟章节 1' }));
    expect(
      window.localStorage.getItem('ricetext:active-chapter:demo-post'),
    ).toBe('0');
  });

  it('发布前 flush 自动保存，并可关闭成功提示', async () => {
    renderPage(identities[0]!);
    await waitFor(() => expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'true'));
    fireEvent.click(screen.getByRole('button', { name: '极简' }));
    fireEvent.click(screen.getByRole('button', { name: '模拟发布' }));

    await waitFor(() => expect(mocks.flush).toHaveBeenCalledTimes(1));
    // 无内容差异（mock 保存未推进修订）：明确提示未创建新版本。
    expect(screen.getByText(/内容没有变化，未创建新版本/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(screen.queryByText(/内容没有变化，未创建新版本/)).not.toBeInTheDocument();
  });

  it('在编辑区内比较历史版本并可退出恢复编辑器', async () => {
    mocks.getDocument.mockResolvedValueOnce(twoChapterDoc);
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByTestId('editor')).toBeInTheDocument());

    fireEvent.click(await screen.findByRole('button', { name: '模拟比较' }));
    await waitFor(() => expect(mocks.getRevision).toHaveBeenCalledWith('demo-post', 17));
    expect(await screen.findByRole('region', { name: '版本格式比较视图' })).toBeInTheDocument();
    expect(screen.getAllByText('历史内容').length).toBeGreaterThan(0);
    expect(screen.getAllByText('新增或修改内容').length).toBeGreaterThan(0);
    expect(screen.queryByText('当前版本')).not.toBeInTheDocument();
    await waitFor(() => expect(container.querySelectorAll('.ProseMirror')).toHaveLength(1));
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '移动' }));
    expect(screen.getByRole('region', { name: '版本格式比较视图' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '退出比较' }));
    expect(screen.getByTestId('editor')).toHaveAttribute('data-mode', 'mobile');
  });

  it('打开间贴回复树并执行指定版本回退', async () => {
    mocks.getCommentThread.mockResolvedValueOnce([{ id: 'comment' }]);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '模拟间贴锚点' }));
    expect(screen.getByRole('dialog', { name: '段落间贴' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.getCommentThread).toHaveBeenCalledWith('demo-post', 'thread_1'));
    expect(await screen.findByText('模拟回复树 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    fireEvent.click(await screen.findByRole(
      'button',
      { name: '模拟回退' },
      { timeout: 5_000 },
    ));
    await waitFor(() => expect(mocks.restoreRevision).toHaveBeenCalledWith('demo-post', 17, 18));
    expect(screen.getByText('已回退到版本 17，并创建版本 19')).toBeInTheDocument();
  });

  it('回退失败时显示接口错误', async () => {
    mocks.restoreRevision.mockRejectedValueOnce(new Error('目标版本不存在'));
    renderPage();
    fireEvent.click(await screen.findByRole(
      'button',
      { name: '模拟回退' },
      { timeout: 5_000 },
    ));
    expect(await screen.findByText('目标版本不存在')).toBeInTheDocument();
  });

  it('按章加载并保存长文本上传后的标准正文', async () => {
    const uploadedContent: RichTextNode = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, chapterStart: true, textAlign: 'left' },
          content: [{ type: 'text', text: '上传章节' }],
        },
        {
          type: 'paragraph',
          attrs: { textAlign: 'left' },
          content: [{ type: 'text', text: '第一行' }],
        },
        { type: 'paragraph', attrs: { textAlign: 'left' } },
        {
          type: 'paragraph',
          attrs: { textAlign: 'left' },
          content: [{ type: 'text', text: '第三行' }],
        },
      ],
    };
    mocks.getDocument.mockResolvedValueOnce({
      ...defaultDocument,
      content: { type: 'doc', content: [] },
      storage: 'server',
    });
    mocks.listForumChapters.mockResolvedValueOnce([
      {
        id: 'uploaded-chapter',
        title: '上传章节',
        order: 0,
        documentId: 'demo-post',
        revision: 1,
        savedAt: defaultDocument.savedAt,
        hidden: false,
      },
    ]);
    mocks.getLongTextChapter.mockResolvedValue({
      id: 'uploaded-chapter',
      title: '上传章节',
      order: 0,
      documentId: 'demo-post',
      revision: 1,
      savedAt: defaultDocument.savedAt,
      hidden: false,
      content: uploadedContent,
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('editor')).toHaveAttribute(
        'data-content',
        JSON.stringify(uploadedContent),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '模拟发布' }));
    await waitFor(() =>
      expect(mocks.uploadLongTextChapter).toHaveBeenCalledWith(
        'demo-post',
        'uploaded-chapter',
        expect.objectContaining({
          order: 0,
          baseRevision: 1,
          content: expect.objectContaining({ type: 'doc' }),
        }),
      ),
    );
    expect(await screen.findByText('章节已保存为版本 2')).toBeInTheDocument();
  });

  it('冲突时允许复制本地正文', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mocks.autosave.mockReturnValue(autosaveValue('conflict'));
    renderPage();

    expect(screen.getByText('服务器版本已更新')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'true'),
    );
    fireEvent.click(screen.getByRole('button', { name: '复制本地副本' }));
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(defaultDocument.content, null, 2));
  });
});
