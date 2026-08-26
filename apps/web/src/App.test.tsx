import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { useAppContext } from './app-context';

vi.mock('./pages/ComposePage', () => ({ default: () => <main>模拟编辑页</main> }));
vi.mock('./pages/ReadPage', () => ({ default: () => <main>模拟阅读页</main> }));

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true });
    window.matchMedia = vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    window.history.pushState({}, '', '/compose');
  });

  it('渲染主导航并在编辑与阅读路由间切换', async () => {
    render(<App />);
    expect(await screen.findByText('模拟编辑页')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '编辑' })).toHaveClass('!text-primary');

    fireEvent.click(screen.getByRole('link', { name: '阅读' }));
    expect(await screen.findByText('模拟阅读页')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '阅读' })).toHaveClass('!text-primary');
  });

  it('从本地恢复身份，并把切换后的身份持久化', async () => {
    localStorage.setItem('ricetext:identity', 'user_moderator');
    render(<App />);
    await screen.findByText('模拟编辑页');
    expect(screen.getByText('版务小禾')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('button', { name: '切换论坛身份' }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: /晚风翻页/ }));

    await waitFor(() => expect(screen.getByText('晚风翻页')).toBeInTheDocument());
    expect(localStorage.getItem('ricetext:identity')).toBe('user_reader');
  });

  it('移动端向下滚动收起页头，向上滚动后恢复', async () => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === '(max-width: 840px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    render(<App />);
    const header = screen.getByRole('banner');
    expect(header).toHaveAttribute('data-hidden', 'false');

    window.scrollY = 160;
    fireEvent.scroll(window);
    await waitFor(() => expect(header).toHaveAttribute('data-hidden', 'true'));

    window.scrollY = 80;
    fireEvent.scroll(window);
    await waitFor(() => expect(header).toHaveAttribute('data-hidden', 'false'));
  });

  it('未知路由重定向到编辑页', async () => {
    window.history.pushState({}, '', '/missing');
    render(<App />);
    expect(await screen.findByText('模拟编辑页')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/compose');
  });

  it('在 Provider 外调用上下文会给出明确错误', () => {
    function Consumer() {
      useAppContext();
      return null;
    }
    expect(() => render(<Consumer />)).toThrow('useAppContext 必须在 AppContext.Provider 内使用');
  });
});
