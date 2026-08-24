import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryState {
  error: Error | null;
}

/** 全局错误边界：渲染出错时展示错误信息而不是白屏。 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ErrorBoundary caught:", error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="mx-auto my-12 max-w-[860px] rounded-lg border border-[#f0b4b0] bg-[#fdf1f0] p-6 font-mono text-[13px] leading-relaxed text-[#8f2b24] whitespace-pre-wrap break-words">
          <h2 className="mb-3 text-base">页面渲染出错</h2>
          <p>{this.state.error.message}</p>
          <pre className="m-0">{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
