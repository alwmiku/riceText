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
        <div
          style={{
            maxWidth: 860,
            margin: "48px auto",
            padding: "24px",
            fontFamily: "monospace",
            fontSize: 13,
            lineHeight: 1.6,
            color: "#8f2b24",
            background: "#fdf1f0",
            border: "1px solid #f0b4b0",
            borderRadius: 8,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>
            页面渲染出错
          </h2>
          <p>{this.state.error.message}</p>
          <pre style={{ margin: 0 }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
