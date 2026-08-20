import { RichTextViewer, type JSONContent } from '@ricetext/editor-core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { defaultDocument } from '../../lib/seed';

describe('RichTextViewer', () => {
  it('渲染静态正文且不创建编辑面板', () => {
    const { container } = render(<RichTextViewer content={defaultDocument.content as JSONContent} />);
    expect(screen.getByText('雾港来信：第三章讨论与校订')).toBeInTheDocument();
    expect(container.querySelector('[contenteditable="true"]')).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    const dice = screen.getByTitle('4 + 3 + 5');
    expect(dice).toHaveTextContent('3d5');
    expect(dice).toHaveTextContent('12');
  });

  it('读者未回复时隐藏回复可见内容', () => {
    render(<RichTextViewer content={defaultDocument.content as JSONContent} interactions={{ isReplyGateVisible: () => false }} />);
    expect(screen.getByText('回复主题后显示本段航海日志。')).toBeInTheDocument();
    expect(screen.queryByText(/日志坐标/)).not.toBeInTheDocument();
  });

  it('黑幕可通过点击切换揭示状态', () => {
    const { container } = render(<RichTextViewer content={defaultDocument.content as JSONContent} />);
    const spoiler = container.querySelector('.rt-spoiler')!;
    expect(spoiler).not.toHaveClass('rt-spoiler--revealed');
    fireEvent.click(spoiler);
    expect(spoiler).toHaveClass('rt-spoiler--revealed');
  });
});
