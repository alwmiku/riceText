import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../app-context';
import { defaultDocument, identities, seedComments } from '../lib/seed';
import type { DocumentEnvelope, SeedIdentity } from '../lib/types';
import ReadPage from './ReadPage';

const mocks = vi.hoisted(() => ({ getCommentThread: vi.fn(), getDocument: vi.fn() }));

vi.mock('../lib/api', () => ({
  getCommentThread: mocks.getCommentThread,
  getDocument: mocks.getDocument,
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

function renderPage(identity: SeedIdentity) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><AppContext.Provider value={{ identity, setIdentity: vi.fn() }}>{children}</AppContext.Provider></QueryClientProvider>;
  return render(<ReadPage />, { wrapper });
}

describe('ReadPage', () => {
  beforeEach(() => {
    mocks.getDocument.mockReset().mockResolvedValue(interactiveDocument);
    mocks.getCommentThread.mockReset().mockResolvedValue(seedComments);
  });

  it('作者可取得付费附件但不会在阅读器自动看到回复可见正文，且不能参与自己的投票', async () => {
    renderPage(identities[0]!);
    expect(await screen.findByText('章节资料.zip')).toBeInTheDocument();
    expect(screen.queryByText(/日志坐标/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回复主题后显示本段航海日志。' })).toBeInTheDocument();
    expect(screen.getByText('@晚风翻页')).toBeInTheDocument();

    const attachment = screen.getByText('章节资料.zip').closest('button')!;
    expect(attachment).toHaveTextContent('购买 · 20');
    fireEvent.click(attachment);
    expect(screen.getByText('章节资料.zip').closest('button')).toHaveTextContent('下载');

    expect(screen.getByRole('button', { name: /守塔人.*28 票/ })).toBeDisabled();
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
});
