import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderSuggestion } from "./ReaderSuggestion";

const mocks = vi.hoisted(() => ({
  submitSuggestion: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  submitSuggestion: mocks.submitSuggestion,
}));

function renderSuggestion() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReaderSuggestion
        documentId="demo-post"
        chapterId="chapter-1"
        chapterTitle="第一章 · 潮汐表"
        lines={["第一章 · 潮汐表", "灯塔正好熄灭。"]}
      >
        <article className="rt-viewer">
          <div className="tiptap ProseMirror">
            <h2>第一章 · 潮汐表</h2>
            <p>灯塔正好熄灭。</p>
          </div>
        </article>
      </ReaderSuggestion>
    </QueryClientProvider>,
  );
}

function selectText(node: Node, text: string) {
  const content = node.textContent ?? "";
  const start = content.indexOf(text);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + text.length);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

describe("ReaderSuggestion", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
    window.getSelection()?.removeAllRanges();
    mocks.submitSuggestion.mockReset().mockResolvedValue({ id: "suggestion-1" });
  });

  it("移动端 selectionchange 后在底部安全区显示修订按钮", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    renderSuggestion();
    const paragraph = screen.getByText("灯塔正好熄灭。");
    const range = selectText(paragraph.firstChild!, "正好");
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({
        top: 240,
        bottom: 268,
        left: 120,
        right: 180,
        width: 60,
        height: 28,
        x: 120,
        y: 240,
        toJSON: () => ({}),
      }),
    });

    document.dispatchEvent(new Event("selectionchange"));
    const action = await screen.findByRole("button", {
      name: "提交所选文字修订：正好",
    });
    expect(action).toHaveClass(
      "fixed",
      "right-4",
      "left-4",
      "bottom-[calc(16px+env(safe-area-inset-bottom))]",
    );
    expect(action.style.top).toBe("");
    fireEvent.click(action);
    expect(screen.getByRole("dialog", { name: "提交修订" })).toBeInTheDocument();
  });

  it("桌面端仍在选区附近显示修订按钮", async () => {
    renderSuggestion();
    const paragraph = screen.getByText("灯塔正好熄灭。");
    const range = selectText(paragraph.firstChild!, "正好");
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({
        top: 240,
        bottom: 268,
        left: 120,
        right: 180,
        width: 60,
        height: 28,
        x: 120,
        y: 240,
        toJSON: () => ({}),
      }),
    });

    document.dispatchEvent(new Event("selectionchange"));
    const action = await screen.findByRole("button", {
      name: "提交所选文字修订：正好",
    });
    expect(action).toHaveStyle({ top: "196px", left: "150px" });
  });

  it("把阅读器选区作为带章节和行定位的修订提交", async () => {
    renderSuggestion();
    const paragraph = screen.getByText("灯塔正好熄灭。");
    selectText(paragraph.firstChild!, "正好");

    fireEvent.mouseUp(paragraph);
    expect(screen.getByText(/已选择「正好」/)).toHaveTextContent("本章第 2 行");
    fireEvent.click(screen.getByRole("button", { name: "提交修订" }));
    fireEvent.change(screen.getByLabelText("修订为"), {
      target: { value: "恰好" },
    });
    fireEvent.change(screen.getByLabelText("修订说明"), {
      target: { value: "避免重复用词" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交给作者" }));

    await waitFor(() =>
      expect(mocks.submitSuggestion).toHaveBeenCalledWith("demo-post", {
        fromText: "正好",
        toText: "恰好",
        reason: "避免重复用词",
        chapterId: "chapter-1",
        chapterTitle: "第一章 · 潮汐表",
        lineNo: 2,
        lineText: "灯塔正好熄灭。",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("修订已提交给作者审核");
  });

  it.each(["清空", "折叠", "移到正文外"] as const)(
    "%s 选区后自动隐藏旧修订入口，再选文字可重新出现",
    async (kind) => {
      renderSuggestion();
      const paragraph = screen.getByText("灯塔正好熄灭。");
      selectText(paragraph.firstChild!, "正好");
      fireEvent.mouseUp(paragraph);
      expect(screen.getByRole("button", { name: "提交修订" })).toBeInTheDocument();
      const outside = document.createElement("p");
      outside.textContent = "正文之外";
      document.body.append(outside);
      act(() => {
        if (kind === "清空") window.getSelection()!.removeAllRanges();
        else if (kind === "折叠") window.getSelection()!.collapseToEnd();
        else {
          selectText(outside.firstChild!, "正文之外");
        }
        document.dispatchEvent(new Event("selectionchange"));
      });
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "提交修订" })).not.toBeInTheDocument(),
      );
      outside.remove();
      selectText(paragraph.firstChild!, "灯塔");
      fireEvent.mouseUp(paragraph);
      expect(await screen.findByText(/已选择「灯塔」/)).toBeInTheDocument();
    },
  );

  it("弹窗打开后清空选区不会丢失草稿，关闭后不恢复旧入口", async () => {
    renderSuggestion();
    const paragraph = screen.getByText("灯塔正好熄灭。");
    selectText(paragraph.firstChild!, "正好");
    fireEvent.mouseUp(paragraph);
    fireEvent.click(screen.getByRole("button", { name: "提交修订" }));
    fireEvent.change(screen.getByLabelText("修订为"), { target: { value: "恰好" } });
    act(() => {
      window.getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(screen.getByLabelText("原文")).toHaveValue("正好");
    expect(screen.getByLabelText("修订为")).toHaveValue("恰好");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "提交修订" })).not.toBeInTheDocument();
    expect(screen.queryByText(/已选择/)).not.toBeInTheDocument();
  });

  it("滚动时隐藏，停下后按最新坐标显示；选区滚出视口不留下按钮", () => {
    vi.useFakeTimers();
    renderSuggestion();
    const paragraph = screen.getByText("灯塔正好熄灭。");
    const range = selectText(paragraph.firstChild!, "正好");
    let top = 240;
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({ top, bottom: top + 28, left: 120, right: 180, width: 60, height: 28 }),
    });
    fireEvent.mouseUp(paragraph);
    act(() => {
      vi.advanceTimersByTime(180);
    });
    const action = () => screen.queryByRole("button", { name: "提交所选文字修订：正好" });
    expect(action()).toHaveStyle({ top: "196px" });
    top = 140;
    fireEvent.scroll(window);
    expect(action()).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.scroll(paragraph.closest("article")!);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(action()).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(61);
    });
    expect(action()).toHaveStyle({ top: "96px" });
    top = -80;
    fireEvent.scroll(window);
    act(() => {
      vi.advanceTimersByTime(161);
    });
    expect(action()).not.toBeInTheDocument();
    top = 300;
    fireEvent.resize(window);
    act(() => {
      vi.advanceTimersByTime(161);
    });
    expect(action()).toHaveStyle({ top: "256px" });
    window.getSelection()!.removeAllRanges();
    fireEvent.scroll(window);
    act(() => {
      vi.advanceTimersByTime(161);
    });
    expect(action()).not.toBeInTheDocument();
  });

  it("拖选期间持续隐藏，松手后恢复，点击入口能正常打开弹窗", () => {
    vi.useFakeTimers();
    renderSuggestion();
    const paragraph = screen.getByText("灯塔正好熄灭。");
    selectText(paragraph.firstChild!, "正好");
    fireEvent.mouseUp(paragraph);
    act(() => {
      vi.advanceTimersByTime(180);
    });
    expect(screen.getByRole("button", { name: "提交修订" })).toBeInTheDocument();
    fireEvent.pointerDown(paragraph);
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByRole("button", { name: "提交修订" })).not.toBeInTheDocument();
    fireEvent.pointerUp(window);
    act(() => {
      vi.advanceTimersByTime(161);
    });
    const action = screen.getByRole("button", { name: "提交修订" });
    fireEvent.pointerDown(action);
    fireEvent.pointerUp(action);
    fireEvent.click(action);
    expect(screen.getByRole("dialog", { name: "提交修订" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("修订为"), { target: { value: "草稿保留" } });
    fireEvent.scroll(window);
    fireEvent.resize(window);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByLabelText("修订为")).toHaveValue("草稿保留");
  });

  it("手机视觉视口滚动和缩放也隐藏再恢复，卸载会清理待执行回调", () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    const viewport = Object.assign(new EventTarget(), {
      offsetTop: 0,
      offsetLeft: 0,
      width: 390,
      height: 600,
    });
    vi.stubGlobal("visualViewport", viewport);
    const { unmount } = renderSuggestion();
    const paragraph = screen.getByText("灯塔正好熄灭。");
    const range = selectText(paragraph.firstChild!, "正好");
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({ top: 240, bottom: 268, left: 120, right: 180, width: 60, height: 28 }),
    });
    fireEvent.mouseUp(paragraph);
    act(() => {
      vi.advanceTimersByTime(180);
    });
    const action = () => screen.queryByRole("button", { name: "提交所选文字修订：正好" });
    expect(action()).toHaveClass("fixed", "right-4", "left-4");
    act(() => {
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(action()).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(161);
    });
    expect(action()).toBeInTheDocument();
    act(() => {
      viewport.height = 200;
      viewport.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(161);
    });
    expect(action()).not.toBeInTheDocument();
    act(() => {
      viewport.height = 600;
      viewport.dispatchEvent(new Event("resize"));
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(200);
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(action()).not.toBeInTheDocument();
  });

  it("允许把修订内容留空以提交删除建议", async () => {
    renderSuggestion();
    const paragraph = screen.getByText("灯塔正好熄灭。");
    selectText(paragraph.firstChild!, "正好");

    fireEvent.mouseUp(paragraph);
    fireEvent.click(screen.getByRole("button", { name: "提交修订" }));
    fireEvent.change(screen.getByLabelText("修订为"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("修订说明"), {
      target: { value: "删除多余文字" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交给作者" }));

    await waitFor(() =>
      expect(mocks.submitSuggestion).toHaveBeenCalledWith(
        "demo-post",
        expect.objectContaining({
          fromText: "正好",
          toText: "",
          reason: "删除多余文字",
        }),
      ),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("拒绝提交与原文相同的内容", () => {
    renderSuggestion();
    const paragraph = screen.getByText("灯塔正好熄灭。");
    selectText(paragraph.firstChild!, "正好");

    fireEvent.mouseUp(paragraph);
    fireEvent.click(screen.getByRole("button", { name: "提交修订" }));
    fireEvent.click(screen.getByRole("button", { name: "提交给作者" }));

    expect(screen.getByRole("alert")).toHaveTextContent("请填写与原文不同的修订内容");
    expect(mocks.submitSuggestion).not.toHaveBeenCalled();
  });
});
