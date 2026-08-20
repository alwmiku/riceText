import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { identities, seedComments } from '../../lib/seed';
import { CommentThread } from './CommentThread';

describe('CommentThread', () => {
  it('支持赞与发送根回复', () => {
    render(<CommentThread identity={identities[1]!} initial={seedComments} />);
    const firstLike = screen.getAllByRole('button', { name: '赞' })[0]!;
    fireEvent.click(firstLike);
    expect(firstLike).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText('间贴内容'), { target: { value: '新间贴内容' } });
    fireEvent.click(screen.getByRole('button', { name: '发送间贴' }));
    expect(screen.getByText('新间贴内容')).toBeInTheDocument();
  });
});
