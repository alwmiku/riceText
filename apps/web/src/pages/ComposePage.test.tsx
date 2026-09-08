import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import type * as EditorModule from '../features/editor/RichTextEditor';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../app-context';
import { defaultDocument, identities } from '../lib/seed';
import type { DocumentEnvelope, ForumChapterItem, RichTextNode, SaveState } from '../lib/types';
import { chapterQueryKeys } from '../lib/chapter-query-keys';
import ComposePage from './ComposePage';

const mocks = vi.hoisted(() => ({
  realEditor: null as ComponentType<EditorModule.RichTextEditorProps> | null,
  editorReady: vi.fn<(editor: Editor | null) => void>(),
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
// jsdom 不提供 IndexedDB；本页验证正常存储流程，上传 Hook 测试覆盖失败场景。
vi.mock('../lib/long-text-draft-storage', () => ({
  loadLongTextValue: vi.fn(async () => undefined),
  loadLongTextDraft: vi.fn(async () => undefined),
  loadLongTextRaw: vi.fn(async () => undefined),
  saveLongTextValue: vi.fn(async () => undefined),
  saveLongTextDraft: vi.fn(async () => undefined),
  saveLongTextRaw: vi.fn(async () => undefined),
  deleteLongTextValue: vi.fn(async () => undefined),
}));
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
  RichTextEditor: (props: EditorModule.RichTextEditorProps) => {
    const ActualEditor = mocks.realEditor;
    if (ActualEditor) return <ActualEditor {...props} onReady={(editor) => {
      mocks.editorReady(editor);
      props.onReady?.(editor);
    }} />;
    return <section aria-label="正文编辑区" data-testid="editor" data-mode={props.mode} data-editable={String(props.editable)} data-content={JSON.stringify(props.content)}>
    <button type="button" onClick={() => props.onChange({ type: 'doc', content: [{ type: 'paragraph' }] })}>模拟编辑</button>
    <button type="button" onClick={() => props.onSubmit?.({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'submitted' }] }] })}>模拟发布</button>
    <button type="button" onClick={() => props.onChange({ ...props.content, content: [...(props.content.content ?? []), { type: 'paragraph', content: [{ type: 'text', text: '当前章新编辑' }] }] })}>模拟修改当前章节</button>
    <button type="button" onClick={() => props.onSubmit?.(props.content)}>模拟保存当前章节</button>
    <button type="button" onClick={props.onExpand}>模拟展开</button>
    <button type="button" onClick={() => props.onCommentAnchorOpen?.('thread_1')}>模拟间贴锚点</button>
  </section>;
  },
}));
vi.mock('../features/forum/ForumPanels', () => ({
  ChapterRail: (props: { chapters?: readonly { id: string; title: string }[]; onToggleHidden?: (index: number, hidden: boolean) => void; currentIndex?: number; onSelect: (index: number) => void; onAddChapter?: () => void; createArticle?: boolean; onDelete?: (index: number) => void | Promise<void>; className?: string }) => (
    <aside className={props.className} aria-label="章节目录" data-chapters={String(props.chapters?.length ?? 0)} data-chapter-ids={JSON.stringify(props.chapters?.map((chapter) => chapter.id))} data-active-index={String(props.currentIndex ?? 0)}>
      <span>模拟章节目录</span>
      <button type="button" onClick={() => props.onSelect(0)}>模拟章节 1</button>
      {(props.chapters?.length ?? 0) > 1 ? <button type="button" onClick={() => props.onSelect(1)}>模拟章节 2</button> : null}
      {props.onToggleHidden ? <button type="button" onClick={() => props.onToggleHidden?.(props.currentIndex ?? 0, true)}>模拟隐藏章节</button> : null}
      <button type="button" onClick={() => props.onAddChapter?.()}>{props.createArticle ? '创建文章' : '模拟新增章节'}</button>
      {props.onDelete ? <><button type="button" onClick={() => void props.onDelete?.(0)}>模拟删除章节</button><button type="button" onClick={() => void props.onDelete?.(props.currentIndex ?? 0)}>模拟删除当前章节</button></> : null}
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
  return { ...render(<MemoryRouter><ComposePage /></MemoryRouter>, { wrapper }), client };
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

const chapterRows = (documentId = 'demo-post', hasContent = false): ForumChapterItem[] => [0, 1].map((order) => ({
  id: 'stable-' + order, documentId, order, title: '章节' + order, hasContent,
  revision: 0, hidden: false, savedAt: defaultDocument.savedAt,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function mockStandaloneChapters() {
  mocks.getDocument.mockImplementation(async (id: string) => ({ ...defaultDocument, id, storage: 'server', content: { type: 'doc', content: [] } }));
  mocks.listForumChapters.mockImplementation(async (id: string) => chapterRows(id, true));
  mocks.getLongTextChapter.mockImplementation(async (documentId: string, id: string) => ({
    ...chapterRows(documentId, true).find((row) => row.id === id),
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: documentId + '/' + id + '正文' }] }] },
  }));
}

describe('ComposePage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false, media: '', addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
    window.localStorage.clear();
    mocks.realEditor = null;
    mocks.editorReady.mockReset();
    mocks.autosave.mockReset().mockReturnValue(autosaveValue());
    mocks.createDocumentChapter.mockReset().mockImplementation(async (_documentId: string, input: { title: string; order: number }) => ({
      id: 'chapter-' + String(input.order),
      title: input.title,
      order: input.order,
      documentId: 'demo-post',
      revision: 0,
      savedAt: '2026-09-01T20:00:00.000Z',
    }));
    mocks.setDocumentChapterHidden.mockReset().mockResolvedValue({ hidden: true });
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

  it('报告文档保存错误，不误归因于章节注册', async () => {
    mocks.flush.mockRejectedValueOnce(new Error('已移除不允许使用的属性 type。'));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'true'));
    fireEvent.click(screen.getByRole('button', { name: '模拟发布' }));
    expect(await screen.findByText('保存失败：已移除不允许使用的属性 type。')).toBeInTheDocument();
    expect(screen.queryByText(/新增章节注册失败/)).not.toBeInTheDocument();
    expect(screen.getByTestId('editor')).toBeInTheDocument();
  });

  it('真实空白编辑器输入首字后保持实例和焦点，并连续输入后续段落', async () => {
    const actual = await vi.importActual<typeof EditorModule>('../features/editor/RichTextEditor');
    mocks.realEditor = actual.RichTextEditor;
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(0, 0, 0, 0) });
    mocks.getDocument.mockResolvedValue({ ...defaultDocument, storage: 'server', content: { type: 'doc', content: [{ type: 'paragraph' }] } });
    renderPage();
    await waitFor(() => expect(mocks.editorReady.mock.lastCall?.[0]?.isEditable).toBe(true));
    const editor = mocks.editorReady.mock.lastCall?.[0];
    if (!editor) throw new Error('编辑器未就绪');
    const originalDOM = editor.view.dom;
    act(() => { editor.view.focus(); editor.commands.insertContent('source'); });
    expect(mocks.editorReady.mock.lastCall?.[0]).toBe(editor);
    expect(editor.view.dom).toBe(originalDOM);
    expect(originalDOM.isConnected).toBe(true);
    expect(document.activeElement).toBe(originalDOM);
    fireEvent.keyDown(originalDOM, { key: 'Enter', code: 'Enter' });
    act(() => { editor.commands.insertContent('target'); });
    fireEvent.keyDown(originalDOM, { key: 'Enter', code: 'Enter' });
    act(() => { editor.commands.insertContent('third'); });
    expect(document.activeElement).toBe(originalDOM);
    expect(editor.getJSON().content).toHaveLength(3);
    expect(editor.getText()).toContain('source');
    expect(editor.getText()).toContain('target');
    expect(editor.getText()).toContain('third');
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
    expect(screen.queryByRole('button', { name: '关闭提示' })?.parentElement?.textContent).toContain('已在本地创建《第一篇文章》，点击保存后上传服务器');
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

  it('按正文存在标记加载并保存版本 0 的标准正文', async () => {
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
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      storage: 'server',
    });
    mocks.listForumChapters.mockResolvedValueOnce([
      {
        id: 'uploaded-chapter',
        title: '上传章节',
        order: 0,
        documentId: 'demo-post',
        revision: 0,
        hasContent: true,
        savedAt: defaultDocument.savedAt,
        hidden: false,
      },
    ]);
    mocks.getLongTextChapter.mockResolvedValue({
      id: 'uploaded-chapter',
      title: '上传章节',
      order: 0,
      documentId: 'demo-post',
      revision: 0,
      savedAt: defaultDocument.savedAt,
      hidden: false,
      content: uploadedContent,
    });
    mocks.uploadLongTextChapter.mockResolvedValueOnce({ revision: 1 });
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
          baseRevision: 0,
          content: expect.objectContaining({ type: 'doc' }),
        }),
      ),
    );
    expect(await screen.findByText('章节已保存为版本 1')).toBeInTheDocument();
  });

  it('移动章节按钮默认收边，文字上移时收起，下移或选中文字时展开', async () => {
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      writable: true,
      value: 100,
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '移动' }));
    const trigger = screen.getByRole('button', { name: '打开章节目录' });
    expect(trigger).toHaveAttribute('data-revealed', 'false');

    window.scrollY = 160;
    fireEvent.scroll(window);
    expect(trigger).toHaveAttribute('data-revealed', 'false');

    window.scrollY = 100;
    fireEvent.scroll(window);
    expect(trigger).toHaveAttribute('data-revealed', 'true');

    const editor = screen.getByLabelText('正文编辑区');
    const anchorNode = editor.querySelector('button')?.firstChild ?? editor;
    const selection = vi.spyOn(window, 'getSelection').mockReturnValue({
      anchorNode,
      isCollapsed: false,
    } as unknown as Selection);
    fireEvent(document, new Event('selectionchange'));
    expect(trigger).toHaveAttribute('data-revealed', 'true');
    selection.mockRestore();
  });

  it('从发布章节目录直接删除服务器章节', async () => {
    mocks.getDocument.mockResolvedValueOnce({
      ...defaultDocument,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      storage: 'server',
    });
    mocks.listForumChapters.mockResolvedValueOnce([
      {
        id: 'uploaded-chapter',
        title: '错乱章节',
        order: 0,
        documentId: 'demo-post',
        revision: 1,
        savedAt: defaultDocument.savedAt,
        hidden: false,
      },
    ]);
    mocks.getLongTextChapter.mockResolvedValue({
      id: 'uploaded-chapter',
      title: '错乱章节',
      order: 0,
      documentId: 'demo-post',
      revision: 1,
      savedAt: defaultDocument.savedAt,
      hidden: false,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    renderPage();

    await waitFor(() =>
      expect(mocks.getLongTextChapter).toHaveBeenCalledWith(
        'demo-post',
        'uploaded-chapter',
        expect.any(AbortSignal),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '模拟删除章节' }));

    await waitFor(() =>
      expect(mocks.deleteDocumentChapter).toHaveBeenCalledWith(
        'demo-post',
        'uploaded-chapter',
      ),
    );
    expect(await screen.findByText('已从服务器删除章节「错乱章节」')).toBeInTheDocument();
  });

  it('发布章节删除失败时保留目录行并显示错误', async () => {
    mocks.deleteDocumentChapter.mockRejectedValueOnce(new Error('删除被服务器拒绝'));
    mocks.getDocument.mockResolvedValueOnce({
      ...defaultDocument,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      storage: 'server',
    });
    mocks.listForumChapters.mockResolvedValueOnce([
      {
        id: 'uploaded-chapter',
        title: '保留章节',
        order: 0,
        documentId: 'demo-post',
        revision: 1,
        savedAt: defaultDocument.savedAt,
        hidden: false,
      },
    ]);
    mocks.getLongTextChapter.mockResolvedValue({
      id: 'uploaded-chapter',
      title: '保留章节',
      order: 0,
      documentId: 'demo-post',
      revision: 1,
      savedAt: defaultDocument.savedAt,
      hidden: false,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    renderPage();

    await waitFor(() =>
      expect(mocks.getLongTextChapter).toHaveBeenCalled(),
    );
    const rail = screen.getByRole('complementary', { name: '章节目录' });
    fireEvent.click(screen.getByRole('button', { name: '模拟删除章节' }));

    expect(await screen.findByText('删除被服务器拒绝')).toBeInTheDocument();
    expect(rail).toHaveAttribute('data-chapters', '1');
  });

  it('没有编辑权限时不提供章节删除入口', async () => {
    renderPage(identities[1]!);
    await waitFor(() =>
      expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'false'),
    );
    expect(
      screen.queryByRole('button', { name: '模拟删除章节' }),
    ).not.toBeInTheDocument();
  });

  it('目录数组无序时普通正文编辑保存删除仍绑定服务器实体', async () => {
    const rows = chapterRows();
    mocks.getDocument.mockResolvedValue(twoChapterDoc);
    mocks.listForumChapters.mockResolvedValue([rows[1]!, rows[0]!]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'true'));
    fireEvent.click(screen.getByRole('button', { name: '模拟章节 2' }));
    expect(screen.getByTestId('editor').dataset.content).toContain('陌生的船票');
    fireEvent.click(screen.getByRole('button', { name: '模拟修改当前章节' }));
    fireEvent.click(screen.getByRole('button', { name: '模拟保存当前章节' }));
    await waitFor(() => expect(mocks.flush).toHaveBeenCalledWith(expect.anything(), expect.any(Number), 'stable-1'));
    const savedContent = JSON.stringify(mocks.flush.mock.calls[0]?.[0]);
    expect(savedContent).toContain('潮声沿着旧城墙');
    expect(savedContent).toContain('当前章新编辑');
    expect(mocks.getLongTextChapter).not.toHaveBeenCalled();
    mocks.listForumChapters.mockResolvedValue([rows[0]!]);
    fireEvent.click(screen.getByRole('button', { name: '模拟删除当前章节' }));
    await waitFor(() => expect(mocks.deleteDocumentChapter).toHaveBeenCalledWith('demo-post', 'stable-1'));
    expect(screen.getByTestId('editor').dataset.content).toContain('潮声沿着旧城墙');
    expect(screen.getByTestId('editor').dataset.content).not.toContain('陌生的船票');
  });

  it('持久化章节ID优先于旧位置，并等待目录后再解析身份', async () => {
    const pending = deferred<ForumChapterItem[]>();
    mocks.getDocument.mockResolvedValue(twoChapterDoc);
    mocks.listForumChapters.mockReturnValue(pending.promise);
    localStorage.setItem('ricetext:active-chapter:demo-post', '0');
    localStorage.setItem('ricetext:active-chapter-id:demo-post', 'stable-1');
    renderPage();
    await waitFor(() => expect(mocks.getDocument).toHaveBeenCalled());
    expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'false');
    await act(async () => pending.resolve(chapterRows()));
    await waitFor(() => expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'true'));
    expect(screen.getByTestId('editor').dataset.content).toContain('陌生的船票');
    expect(localStorage.getItem('ricetext:active-chapter-id:demo-post')).toBe('stable-1');
  });

  it('独立章目录重排后当前实体、正文和保存目标保持一致', async () => {
    mockStandaloneChapters();
    const { client } = renderPage();
    await waitFor(() => expect(screen.getByTestId('editor').dataset.content).toContain('demo-post/stable-0正文'));
    fireEvent.click(screen.getByRole('button', { name: '模拟章节 2' }));
    await waitFor(() => expect(screen.getByTestId('editor').dataset.content).toContain('demo-post/stable-1正文'));
    const rows = chapterRows('demo-post', true);
    act(() => client.setQueryData(chapterQueryKeys.directory('demo-post'), [{ ...rows[1]!, order: 0 }, { ...rows[0]!, order: 1 }]));
    await waitFor(() => expect(screen.getByRole('complementary', { name: '章节目录' })).toHaveAttribute('data-active-index', '0'));
    fireEvent.click(screen.getByRole('button', { name: '模拟保存当前章节' }));
    await waitFor(() => expect(mocks.uploadLongTextChapter).toHaveBeenCalledWith('demo-post', 'stable-1', expect.objectContaining({ order: 0 })));
    expect(screen.getByTestId('editor').dataset.content).toContain('demo-post/stable-1正文');
  });

  it('独立正文失败时编辑与快捷保存均被拦截，重试后才允许写入', async () => {
    mockStandaloneChapters();
    mocks.getLongTextChapter.mockRejectedValue(new Error('正文不可用'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('章节加载失败');
    expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'false');
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '模拟编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '模拟发布' }));
    expect(mocks.uploadLongTextChapter).not.toHaveBeenCalled();
    expect(mocks.flush).not.toHaveBeenCalled();
    mocks.getLongTextChapter.mockResolvedValue({ ...chapterRows('demo-post', true)[0], content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '恢复的正文' }] }] } });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'true'));
    expect(screen.getByTestId('editor').dataset.content).toContain('恢复的正文');
  });

  it('空壳占位章不会请求独立正文或保存空白覆盖', async () => {
    mocks.getDocument.mockResolvedValue({ ...defaultDocument, storage: 'server', content: { type: 'doc', content: [] } });
    mocks.listForumChapters.mockResolvedValue(chapterRows());
    renderPage();
    expect(await screen.findByText('本章暂无正文。')).toBeInTheDocument();
    expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'false');
    fireEvent.click(screen.getByRole('button', { name: '模拟发布' }));
    expect(mocks.getLongTextChapter).not.toHaveBeenCalled();
    expect(mocks.uploadLongTextChapter).not.toHaveBeenCalled();
    expect(mocks.flush).not.toHaveBeenCalled();
  });

  it.each(['保存', '隐藏', '删除'] as const)('%s请求期间切章，迟到成功不会改动新章节界面', async (operation) => {
    mockStandaloneChapters();
    const pending = deferred<{ revision: number; deleted: boolean }>();
    const request = operation === '保存' ? mocks.uploadLongTextChapter : operation === '隐藏' ? mocks.setDocumentChapterHidden : mocks.deleteDocumentChapter;
    request.mockReturnValue(pending.promise);
    const { client } = renderPage();
    await waitFor(() => expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'true'));
    fireEvent.click(screen.getByRole('button', { name: operation === '保存' ? '模拟保存当前章节' : operation === '隐藏' ? '模拟隐藏章节' : '模拟删除章节' }));
    await waitFor(() => expect(request).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '模拟章节 2' }));
    await waitFor(() => expect(screen.getByTestId('editor').dataset.content).toContain('stable-1正文'));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    if (operation === '删除') mocks.listForumChapters.mockResolvedValue([{ ...chapterRows('demo-post', true)[1]!, order: 0 }]);
    await act(async () => pending.resolve({ revision: 9, deleted: true }));
    expect(screen.getByTestId('editor').dataset.content).toContain('stable-1正文');
    expect(screen.queryByRole('button', { name: '关闭提示' }), screen.queryByRole('button', { name: '关闭提示' })?.parentElement?.textContent ?? '').not.toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chapterQueryKeys.directory('demo-post') });
    await waitFor(() => expect(client.getQueryData<ForumChapterItem[]>(chapterQueryKeys.directory('demo-post'))).toHaveLength(operation === '删除' ? 1 : 2));
  });

  it('目录尚未返回时新增不会制造覆盖独立第一章的主文档正文', async () => {
    mockStandaloneChapters();
    const pending = deferred<ForumChapterItem[]>();
    mocks.listForumChapters.mockReturnValue(pending.promise);
    renderPage();
    await screen.findByText('模拟创作工具');
    fireEvent.click(screen.getByRole('button', { name: '模拟新增章节' }));
    expect(screen.getByText('章节目录尚未就绪，请加载后再新增')).toBeInTheDocument();
    await act(async () => pending.resolve(chapterRows('demo-post', true)));
    await waitFor(() => expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'true'));
    expect(screen.getByTestId('editor').dataset.content).toContain('stable-0正文');
    expect(mocks.flush).not.toHaveBeenCalled();
  });

  it('旧主文档的单个longTextBlock范围不能误当整篇章节写回或删除', async () => {
    mocks.getDocument.mockResolvedValue({ ...defaultDocument, storage: 'server', content: { type: 'doc', content: [
      { type: 'longTextBlock', attrs: { chapterId: 'stable-0', title: '甲', text: '甲正文' } },
      { type: 'longTextBlock', attrs: { chapterId: 'stable-1', title: '乙', text: '乙正文' } },
    ] } });
    mocks.listForumChapters.mockResolvedValue(chapterRows());
    renderPage();
    await screen.findByText('请在长文本工作台编辑此章节');
    expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'false');
    fireEvent.click(screen.getByRole('button', { name: '模拟编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '模拟发布' }));
    fireEvent.click(screen.getByRole('button', { name: '模拟删除章节' }));
    expect(screen.getByRole('complementary', { name: '章节目录' })).toHaveAttribute('data-chapters', '2');
    expect(mocks.deleteDocumentChapter).not.toHaveBeenCalled();
    expect(mocks.flush).not.toHaveBeenCalled();
  });

  it('独立目录新增不会把新主文档正文映射到已有第一章', async () => {
    mockStandaloneChapters();
    renderPage();
    await waitFor(() => expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'true'));
    fireEvent.click(screen.getByRole('button', { name: '模拟新增章节' }));
    expect(screen.getByText('请在长文本工作台新增并上传章节')).toBeInTheDocument();
    expect(screen.getByTestId('editor').dataset.content).toContain('stable-0正文');
    expect(mocks.flush).not.toHaveBeenCalled();
  });

  it('保存期间离开又返回同一章节，旧保存结果仍不能覆盖本次会话', async () => {
    mockStandaloneChapters();
    const pending = deferred<{ revision: number }>();
    mocks.uploadLongTextChapter.mockReturnValue(pending.promise);
    const { client } = renderPage();
    await waitFor(() => expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'true'));
    fireEvent.click(screen.getByRole('button', { name: '模拟保存当前章节' }));
    await waitFor(() => expect(mocks.uploadLongTextChapter).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '模拟章节 2' }));
    fireEvent.click(screen.getByRole('button', { name: '模拟章节 1' }));
    await act(async () => pending.resolve({ revision: 9 }));
    expect(client.getQueryData<{ revision: number }>(chapterQueryKeys.content('demo-post', 'stable-0'))?.revision).toBe(0);
    expect(screen.queryByRole('button', { name: '关闭提示' }), screen.queryByRole('button', { name: '关闭提示' })?.parentElement?.textContent ?? '').not.toBeInTheDocument();
  });

  it.each(['章节', '文章'] as const)('历史比较期间切换%s，迟到结果不再打开比较界面', async (target) => {
    mocks.getDocument.mockImplementation(async (id: string) => ({ ...twoChapterDoc, id }));
    mocks.listForumChapters.mockImplementation(async (id: string) => chapterRows(id));
    const pending = deferred<DocumentEnvelope>();
    mocks.getRevision.mockReturnValue(pending.promise);
    const articles = ['demo-post', 'other'].map((id) => ({ id, title: id, revision: 18, savedAt: defaultDocument.savedAt, canEdit: true }));
    renderPage(identities[0]!, 'authenticated', articles);
    await waitFor(() => expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'true'));
    fireEvent.click(screen.getByRole('button', { name: '模拟比较' }));
    await waitFor(() => expect(mocks.getRevision).toHaveBeenCalled());
    if (target === '章节') fireEvent.click(screen.getByRole('button', { name: '模拟章节 2' }));
    else fireEvent.change(screen.getByRole('combobox', { name: '选择文章' }), { target: { value: 'other' } });
    await waitFor(() => expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'true'));
    await act(async () => pending.resolve({ ...twoChapterDoc, revision: 17 }));
    expect(screen.queryByRole('region', { name: '版本格式比较视图' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关闭提示' }), screen.queryByRole('button', { name: '关闭提示' })?.parentElement?.textContent ?? '').not.toBeInTheDocument();
  });

  it.each(['章节', '文章'] as const)('回退请求期间切换%s，不用迟到快照替换当前编辑内容', async (target) => {
    mocks.getDocument.mockImplementation(async (id: string) => ({ ...twoChapterDoc, id }));
    mocks.listForumChapters.mockImplementation(async (id: string) => chapterRows(id));
    const pending = deferred<DocumentEnvelope>();
    mocks.restoreRevision.mockReturnValue(pending.promise);
    const articles = ['demo-post', 'other'].map((id) => ({ id, title: id, revision: 18, savedAt: defaultDocument.savedAt, canEdit: true }));
    const autosave = autosaveValue();
    mocks.autosave.mockReturnValue(autosave);
    renderPage(identities[0]!, 'authenticated', articles);
    await waitFor(() => expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'true'));
    fireEvent.click(screen.getByRole('button', { name: '模拟回退' }));
    await waitFor(() => expect(mocks.restoreRevision).toHaveBeenCalled());
    if (target === '章节') fireEvent.click(screen.getByRole('button', { name: '模拟章节 2' }));
    else fireEvent.change(screen.getByRole('combobox', { name: '选择文章' }), { target: { value: 'other' } });
    await waitFor(() => expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'true'));
    await act(async () => pending.resolve({ ...twoChapterDoc, revision: 19, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '迟到的回退正文' }] }] } }));
    expect(screen.getByTestId('editor').dataset.content).not.toContain('迟到的回退正文');
    expect(autosave.acceptSaved).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '关闭提示' }), screen.queryByRole('button', { name: '关闭提示' })?.parentElement?.textContent ?? '').not.toBeInTheDocument();
  });

  it('保存请求切文档后失败，不把旧错误展示在新文章', async () => {
    mockStandaloneChapters();
    const pending = deferred<{ revision: number }>();
    mocks.uploadLongTextChapter.mockReturnValue(pending.promise);
    const articles = ['demo-post', 'other'].map((id) => ({ id, title: id, revision: 18, savedAt: defaultDocument.savedAt, canEdit: true }));
    renderPage(identities[0]!, 'authenticated', articles);
    await waitFor(() => expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'true'));
    fireEvent.click(screen.getByRole('button', { name: '模拟保存当前章节' }));
    await waitFor(() => expect(mocks.uploadLongTextChapter).toHaveBeenCalled());
    fireEvent.change(screen.getByRole('combobox', { name: '选择文章' }), { target: { value: 'other' } });
    await waitFor(() => expect(screen.getByTestId('editor').dataset.content).toContain('other/stable-0正文'));
    await act(async () => pending.reject(new Error('旧文章保存失败')));
    expect(screen.queryByText(/旧文章保存失败/)).not.toBeInTheDocument();
    expect(screen.getByTestId('editor').dataset.content).toContain('other/stable-0正文');
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
