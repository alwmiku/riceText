import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { EditorErrorBoundary } from "./EditorErrorBoundary";

let shouldThrow = false;

function UnstableChild() {
  if (shouldThrow) throw new Error("模拟渲染失败");
  return <p>编辑器内容</p>;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    shouldThrow = false;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("正常渲染子内容，并在页面异常时展示错误详情", () => {
    const { rerender } = render(
      <ErrorBoundary>
        <UnstableChild />
      </ErrorBoundary>,
    );
    expect(screen.getByText("编辑器内容")).toBeInTheDocument();

    shouldThrow = true;
    rerender(
      <ErrorBoundary>
        <UnstableChild />
      </ErrorBoundary>,
    );
    expect(screen.getByText("页面渲染出错")).toBeInTheDocument();
    expect(screen.getByText("模拟渲染失败")).toBeInTheDocument();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("EditorErrorBoundary", () => {
  beforeEach(() => {
    shouldThrow = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("局部捕获异常后可以重试渲染", () => {
    render(
      <EditorErrorBoundary>
        <UnstableChild />
      </EditorErrorBoundary>,
    );
    expect(screen.getByText("长文本编辑区出错")).toBeInTheDocument();
    expect(screen.getByText("模拟渲染失败")).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "重试渲染" }));
    expect(screen.getByText("编辑器内容")).toBeInTheDocument();
  });
});
