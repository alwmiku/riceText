import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../app-context';
import { defaultDocument, identities } from '../lib/seed';
import type { RichTextNode, SaveState } from '../lib/types';
import ComposePage from './ComposePage';

const mocks = vi.hoisted(() => ({
  autosave: vi.fn(),
  flush: vi.fn(),
  getCommentThread: vi.fn(),
  getDocument: vi.fn(),
  restoreRevision: vi.fn(),
}));

vi.mock('../features/editor/useAutosave', () => ({ useAutosave: mocks.autosave }));
vi.mock('../lib/api', () => ({
  getCommentThread: mocks.getCommentThread,
  getDocument: mocks.getDocument,
  restoreRevision: mocks.restoreRevision,
}));
vi.mock('../features/editor/RichTextEditor', () => ({
  RichTextEditor: (props: {
    mode: string;
    editable?: boolean;
    onChange: (content: RichTextNode) => void;
    onSubmit?: (content: RichTextNode) => void;
    onReady?: (editor: null) => void;
    onExpand?: () => void;
    onCommentAnchorOpen?: (id: string) => void;
  }) => <section data-testid="editor" data-mode={props.mode} data-editable={String(props.editable)}>
    <button type="button" onClick={() => props.onChange({ type: 'doc', content: [{ type: 'paragraph' }] })}>模拟编辑</button>
    <button type="button" onClick={() => props.onSubmit?.({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'submitted' }] }] })}>模拟发布</button>
    <button type="button" onClick={props.onExpand}>模拟展开</button>
    <button type="button" onClick={() => props.onCommentAnchorOpen?.('thread_1')}>模拟间贴锚点</button>
  </section>,
}));
vi.mock('../features/demo/DemoPanels', () => ({
  ChapterRail: () => <aside>模拟章节目录</aside>,
  DemoBusinessPanel: (props: { onRestore: (revision: number) => void }) => <aside><span>模拟创作工具</span><button type="button" onClick={() => props.onRestore(17)}>模拟回退</button></aside>,
}));
vi.mock('../features/comments/CommentThread', () => ({
  CommentThread: (props: { initial: readonly unknown[] }) => <div>模拟回复树 {props.initial.length}</div>,
}));

function renderPage(identity = identities[0]!) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><AppContext.Provider value={{ identity, setIdentity: vi.fn() }}>{children}</AppContext.Provider></QueryClientProvider>;
  return render(<ComposePage />, { wrapper });
}

function autosaveValue(state: SaveState = 'saved') {
  return {
    state,
    revision: 18,
    savedAt: defaultDocument.savedAt,
    conflictMessage: state === 'conflict' ? '服务器版本已更新' : '',
    flush: mocks.flush,
    acceptLatest: vi.fn(),
  };
}

describe('ComposePage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false, media: '', addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
    mocks.autosave.mockReset().mockReturnValue(autosaveValue());
    mocks.flush.mockReset().mockResolvedValue(undefined);
    mocks.getDocument.mockReset().mockResolvedValue(defaultDocument);
    mocks.getCommentThread.mockReset().mockResolvedValue([]);
    mocks.restoreRevision.mockReset().mockResolvedValue({ ...defaultDocument, revision: 19, savedAt: '2026-08-20T12:00:00.000Z' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('切换完整、极简和移动布局，并从极简入口展开', () => {
    renderPage();
    expect(screen.getByTestId('editor')).toHaveAttribute('data-mode', 'full');
    expect(screen.getByText('模拟章节目录')).toBeInTheDocument();
    expect(screen.getByText('模拟创作工具')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '极简' }));
    expect(screen.getByTestId('editor')).toHaveAttribute('data-mode', 'compact');
    expect(screen.queryByText('模拟章节目录')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开' }));
    expect(screen.getByTestId('editor')).toHaveAttribute('data-mode', 'full');

    fireEvent.click(screen.getByRole('button', { name: '移动' }));
    expect(screen.getByTestId('editor')).toHaveAttribute('data-mode', 'mobile');
    expect(screen.getByText(/移动编辑/)).toBeInTheDocument();
  });

  it('发布前 flush 自动保存，并可关闭成功提示', async () => {
    renderPage(identities[1]!);
    await waitFor(() => expect(screen.getByTestId('editor')).toHaveAttribute('data-editable', 'true'));
    fireEvent.click(screen.getByRole('button', { name: '极简' }));
    fireEvent.click(screen.getByRole('button', { name: '模拟发布' }));

    await waitFor(() => expect(mocks.flush).toHaveBeenCalledTimes(1));
    expect(screen.getByText('回复已进入演示发布队列')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(screen.queryByText('回复已进入演示发布队列')).not.toBeInTheDocument();
  });

  it('打开间贴回复树并执行指定版本回退', async () => {
    mocks.getCommentThread.mockResolvedValueOnce([{ id: 'comment' }]);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '模拟间贴锚点' }));
    expect(screen.getByRole('dialog', { name: '段落间贴' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.getCommentThread).toHaveBeenCalledWith('demo-post', 'thread_1'));
    expect(await screen.findByText('模拟回复树 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    fireEvent.click(screen.getByRole('button', { name: '模拟回退' }));
    await waitFor(() => expect(mocks.restoreRevision).toHaveBeenCalledWith('demo-post', 17, 18));
    expect(screen.getByText('已回退到版本 17，并创建版本 19')).toBeInTheDocument();
  });

  it('回退失败时显示接口错误', async () => {
    mocks.restoreRevision.mockRejectedValueOnce(new Error('目标版本不存在'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '模拟回退' }));
    expect(await screen.findByText('目标版本不存在')).toBeInTheDocument();
  });

  it('冲突时允许复制本地正文', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mocks.autosave.mockReturnValue(autosaveValue('conflict'));
    renderPage();

    expect(screen.getByText('服务器版本已更新')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制本地副本' }));
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(defaultDocument.content, null, 2));
  });
});
