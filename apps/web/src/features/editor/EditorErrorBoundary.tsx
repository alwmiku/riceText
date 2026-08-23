import { Component, type ReactNode } from "react";

interface EditorErrorBoundaryState {
  error: Error | null;
}

/**
 * 长文本工作台局部错误边界：出错时在页面内显示错误信息与堆栈，
 * 避免整个页面白屏，也便于把精确报错反馈给开发者。
 */
export class EditorErrorBoundary extends Component<
  { children: ReactNode },
  EditorErrorBoundaryState
> {
  state: EditorErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): EditorErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-md border border-[#f0b4b0] bg-[#fdf1f0] p-4 text-sm text-[#8f2b24]">
          <p className="font-semibold">长文本编辑区出错</p>
          <p className="mt-1 break-all">{this.state.error.message}</p>
          <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap text-xs">
            {this.state.error.stack}
          </pre>
          <button
            type="button"
            className="mt-3 rounded border border-[#e0a5a0] px-3 py-1.5 text-xs"
            onClick={() => this.setState({ error: null })}
          >
            重试渲染
          </button>
          <button
            type="button"
            className="mt-3 ml-2 rounded border border-[#e0a5a0] px-3 py-1.5 text-xs"
            onClick={() => window.location.reload()}
          >
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
