import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
}

describe("ReaderSuggestion", () => {
  beforeEach(() => {
    mocks.submitSuggestion.mockReset().mockResolvedValue({ id: "suggestion-1" });
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
    expect(await screen.findByRole("status")).toHaveTextContent(
      "修订已提交给作者审核",
    );
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

    expect(screen.getByRole("alert")).toHaveTextContent(
      "请填写与原文不同的修订内容",
    );
    expect(mocks.submitSuggestion).not.toHaveBeenCalled();
  });
});
