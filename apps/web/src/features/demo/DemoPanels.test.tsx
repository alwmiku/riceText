import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { identities, seedRevisions } from '../../lib/seed';
import { ChapterRail, DemoBusinessPanel, HistoryPanel } from './DemoPanels';

const { getRevisionsMock } = vi.hoisted(() => ({ getRevisionsMock: vi.fn() }));

vi.mock('../../lib/api', () => ({ getRevisions: getRevisionsMock }));

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const chaptersFixture = [
  { id: 'chapter-0', title: '楔子 · 雨季之前' },
  { id: 'chapter-1', title: '第一章 · 潮汐表' },
  { id: 'chapter-2', title: '第二章 · 陌生船票' },
  { id: 'chapter-3', title: '第三章 · 没有寄件人的信' },
  { id: 'chapter-4', title: '第四章 · 待发布' },
];

describe('DemoPanels', () => {
  beforeEach(() => {
    getRevisionsMock.mockReset();
    getRevisionsMock.mockResolvedValue(seedRevisions);
  });

  it('展示章节目录、当前章节和统计', () => {
    renderWithQuery(
      <ChapterRail chapters={chaptersFixture} currentIndex={1} onSelect={vi.fn()} />,
    );
    expect(screen.getByRole('complementary', { name: '章节目录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /第一章.*潮汐表/ })).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: /第三章.*没有寄件人的信/ })).toBeInTheDocument();
    expect(screen.getByText('3,842')).toBeInTheDocument();
    expect(screen.getByText('创作中')).toBeInTheDocument();
  });

  it('点击章节触发切换回调', () => {
    const onSelect = vi.fn();
    renderWithQuery(
      <ChapterRail chapters={chaptersFixture} currentIndex={1} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /第二章.*陌生船票/ }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('接受和拒绝校订建议后显示最终状态', () => {
    renderWithQuery(<DemoBusinessPanel identity={identities[0]!} documentId="demo-post" onRestore={vi.fn()} />);

    fireEvent.click(screen.getAllByRole('button', { name: '接受' })[0]!);
    expect(screen.getByText('已合并并建版')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '拒绝' })[0]!);
    expect(screen.getByText('已拒绝并通知')).toBeInTheDocument();
  });

  it('演示附件购买并展示 70% 作者分成', () => {
    renderWithQuery(<DemoBusinessPanel identity={identities[1]!} documentId="demo-post" onRestore={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '附件' }));

    expect(screen.getByText('作者获得 14（70%）')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '购买附件' }));
    expect(screen.getByRole('button', { name: '已购买，可下载' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下载时间线勘误' })).toBeEnabled();
  });

  it('金币不足时禁止购买附件', () => {
    renderWithQuery(<DemoBusinessPanel identity={{ ...identities[1]!, coins: 10 }} documentId="demo-post" onRestore={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '附件' }));
    expect(screen.getByRole('button', { name: '购买附件' })).toBeDisabled();
  });

  it('读者可以选择投票并展开实名明细', () => {
    renderWithQuery(<DemoBusinessPanel identity={identities[1]!} documentId="demo-post" onRestore={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '投票' }));

    fireEvent.click(screen.getByRole('button', { name: /灯塔守望人.*28 票/ }));
    expect(screen.getByRole('button', { name: /灯塔守望人.*29 票/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看实名投票明细' }));
    expect(screen.getByText('晚风翻页 → 灯塔守望人')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起实名明细' }));
    expect(screen.queryByText('晚风翻页 → 灯塔守望人')).not.toBeInTheDocument();
  });

  it('加载历史并把目标版本交给回滚回调', async () => {
    const onRestore = vi.fn();
    renderWithQuery(<DemoBusinessPanel identity={identities[0]!} documentId="post_7" onRestore={onRestore} />);
    fireEvent.click(screen.getByRole('button', { name: '历史' }));

    expect(await screen.findByText('版本 18')).toBeInTheDocument();
    expect(getRevisionsMock).toHaveBeenCalledWith('post_7', expect.any(AbortSignal));
    fireEvent.click(screen.getAllByRole('button', { name: '回退' })[1]!);
    expect(onRestore).toHaveBeenCalledWith(17);
  });

  it('HistoryPanel 支持空列表和直接回退', () => {
    const onRestore = vi.fn();
    const { rerender } = render(<HistoryPanel revisions={[]} onRestore={onRestore} />);
    expect(screen.queryByRole('button', { name: '回退' })).not.toBeInTheDocument();

    rerender(<HistoryPanel revisions={seedRevisions.slice(0, 1)} onRestore={onRestore} />);
    fireEvent.click(screen.getByRole('button', { name: '回退' }));
    expect(onRestore).toHaveBeenCalledWith(18);
  });
});
