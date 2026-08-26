import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ForumSuggestionBatch } from "../../lib/types";
import { SuggestionBatchCard } from "./SuggestionBatchCard";

const batch: ForumSuggestionBatch = {
  id: "batch-1",
  documentId: "demo-post",
  chapterId: "chapter-0",
  chapterTitle: "第一章",
  baseRevision: 3,
  beforeContent: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "原文一" }] },
      { type: "paragraph", content: [{ type: "text", text: "将被删除" }] },
    ],
  },
  afterContent: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "修改一" }] },
    ],
  },
  steps: [
    { stepType: "replace", from: 1, to: 4 },
    { stepType: "replace", from: 5, to: 9 },
  ],
  reason: "整章调整",
  status: "pending",
  authorId: "reader",
  reviewerId: null,
  createdAt: "2026-08-20T08:00:00.000Z",
};

describe("SuggestionBatchCard", () => {
  it("待审批次展示全部操作和删除整行差异", () => {
    const onReview = vi.fn();
    render(<SuggestionBatchCard batch={batch} busy={false} onReview={onReview} />);
    expect(screen.getByText("2 处行级变化 · 2 个步骤")).toBeInTheDocument();
    expect(screen.getByText("（删除整行）")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "接受全部修改" }));
    fireEvent.click(screen.getByRole("button", { name: "拒绝整批" }));
    expect(onReview).toHaveBeenNthCalledWith(1, "approve");
    expect(onReview).toHaveBeenNthCalledWith(2, "reject");
  });

  it("已接受和已拒绝批次只展示归档状态", () => {
    const onReview = vi.fn();
    const { rerender } = render(
      <SuggestionBatchCard
        batch={{ ...batch, status: "approved", reason: "" }}
        busy={false}
        onReview={onReview}
      />,
    );
    expect(screen.getByText("已接受")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(
      <SuggestionBatchCard
        batch={{ ...batch, status: "rejected" }}
        busy
        onReview={onReview}
      />,
    );
    expect(screen.getByText("已拒绝")).toBeInTheDocument();
    expect(onReview).not.toHaveBeenCalled();
  });
});
