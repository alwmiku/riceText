import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ForumSuggestion } from "../../lib/api";
import { ProofreadWorkspace } from "./ProofreadWorkspace";

const mocks = vi.hoisted(() => ({
  listSuggestionBatches: vi.fn(),
  listSuggestions: vi.fn(),
  reviewSuggestionBatch: vi.fn(),
  reviewSuggestion: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  listSuggestionBatches: mocks.listSuggestionBatches,
  listSuggestions: mocks.listSuggestions,
  reviewSuggestionBatch: mocks.reviewSuggestionBatch,
  reviewSuggestion: mocks.reviewSuggestion,
}));

const makeSuggestion = (
  overrides: Partial<ForumSuggestion> & Pick<ForumSuggestion, "id" | "status">,
): ForumSuggestion => {
  const { id, status, ...rest } = overrides;
  return {
    id,
    documentId: "demo-post",
    chapterId: "chapter-0",
    chapterTitle: "第一章 · 潮汐表",
    lineNo: 2,
    lineText: "灯塔正好熄灭。",
    fromText: "正好",
    toText: "恰好",
    reason: "待审核说明",
    status,
    authorId: "reader",
    reviewerId: null,
    createdAt: "2026-08-20T08:00:00.000Z",
    ...rest,
  };
};

let items: ForumSuggestion[] = [];

function renderWorkspace() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    ...render(
      <ProofreadWorkspace
        documentId="demo-post"
        baseRevision={18}
        documentTitle="雾港来信"
        chapterId="chapter-0"
        chapterTitle="第一章 · 潮汐表"
        lines={["第一章 · 潮汐表", "灯塔正好熄灭。", "潮声仍在。"]}
        onExit={vi.fn()}
      />,
      { wrapper },
    ),
  };
}

describe("ProofreadWorkspace", () => {
  beforeEach(() => {
    items = [
      makeSuggestion({ id: "pending", status: "pending" }),
      makeSuggestion({
        id: "approved",
        status: "approved",
        reason: "已经接受的说明",
      }),
      makeSuggestion({
        id: "rejected",
        status: "rejected",
        lineNo: 3,
        lineText: "潮声仍在。",
        fromText: "仍在",
        toText: "未歇",
        reason: "已经拒绝的说明",
      }),
      makeSuggestion({
        id: "other-chapter",
        status: "pending",
        chapterId: "chapter-1",
      }),
    ];
    mocks.listSuggestionBatches.mockReset().mockResolvedValue([]);
    mocks.reviewSuggestionBatch.mockReset();
    mocks.listSuggestions.mockReset().mockImplementation(async () => [...items]);
    mocks.reviewSuggestion.mockReset().mockImplementation(
      async (id: string, decision: "approve" | "reject", baseRevision: number) => {
        const reviewed = {
          ...items.find((item) => item.id === id)!,
          status: decision === "approve" ? ("approved" as const) : ("rejected" as const),
          reviewerId: "author",
        };
        items = items.map((item) => (item.id === id ? reviewed : item));
        return {
          suggestion: reviewed,
          document:
            decision === "approve"
              ? {
                  id: "demo-post",
                  title: "雾港来信",
                  schemaVersion: 1,
                  revision: baseRevision + 1,
                  savedAt: "2026-08-20T09:00:00.000Z",
                  storage: "server" as const,
                  content: { type: "doc" as const, content: [] },
                }
              : null,
        };
      },
    );
  });

  it("接受待审建议后从阅读审核页移除并同步正文缓存", async () => {
    const { client } = renderWorkspace();
    expect(await screen.findByText(/待审核说明/)).toBeInTheDocument();
    expect(screen.queryByText(/已经接受的说明/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "接受" }));
    await waitFor(() =>
      expect(mocks.reviewSuggestion).toHaveBeenCalledWith("pending", "approve", 18),
    );
    await waitFor(() =>
      expect(screen.queryByText(/待审核说明/)).not.toBeInTheDocument(),
    );
    expect(client.getQueryData(["document", "demo-post"])).toMatchObject({
      revision: 19,
    });

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByText(/已经接受的说明/)).not.toBeInTheDocument();
  });

  it("拒绝待审建议后从阅读审核页移除", async () => {
    renderWorkspace();
    await screen.findByText(/待审核说明/);
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));

    await waitFor(() =>
      expect(mocks.reviewSuggestion).toHaveBeenCalledWith("pending", "reject", 18),
    );
    await waitFor(() =>
      expect(screen.queryByText(/待审核说明/)).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/已经拒绝的说明/)).not.toBeInTheDocument();
  });

  it("作者可以一次接受整章批次的全部修改", async () => {
    const batch = {
      id: "batch-1",
      documentId: "demo-post",
      chapterId: "chapter-0",
      chapterTitle: "第一章 · 潮汐表",
      baseRevision: 18,
      beforeContent: {
        type: "doc" as const,
        content: [{ type: "paragraph", content: [{ type: "text", text: "原文" }] }],
      },
      afterContent: {
        type: "doc" as const,
        content: [{ type: "paragraph", content: [{ type: "text", text: "修改后" }] }],
      },
      steps: [{ stepType: "replace", from: 1, to: 3 }],
      reason: "整章统一调整",
      status: "pending" as const,
      authorId: "reader",
      reviewerId: null,
      createdAt: "2026-08-20T08:00:00.000Z",
    };
    mocks.listSuggestionBatches.mockResolvedValue([batch]);
    mocks.reviewSuggestionBatch.mockResolvedValue({
      batch: { ...batch, status: "approved", reviewerId: "author" },
      document: null,
    });
    renderWorkspace();

    expect(await screen.findByText("整章统一调整")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "接受全部修改" }));
    await waitFor(() =>
      expect(mocks.reviewSuggestionBatch).toHaveBeenCalledWith(
        "batch-1",
        "approve",
        18,
      ),
    );
  });

  it("审核失败时保留待审建议并显示错误", async () => {
    mocks.reviewSuggestion.mockRejectedValueOnce(new Error("正文已变化"));
    renderWorkspace();
    await screen.findByText(/待审核说明/);
    fireEvent.click(screen.getByRole("button", { name: "接受" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("正文已变化");
    expect(screen.getByText(/待审核说明/)).toBeInTheDocument();
  });
});
