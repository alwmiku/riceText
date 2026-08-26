import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChapterSuggestionEditor } from "./ChapterSuggestionEditor";

const mocks = vi.hoisted(() => ({
  submitSuggestionBatch: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  submitSuggestionBatch: mocks.submitSuggestionBatch,
}));

vi.mock("../editor/RichTextEditor", () => ({
  RichTextEditor: (props: { onChange: (content: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        props.onChange({
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "第一章" }],
            },
            { type: "paragraph", content: [{ type: "text", text: "修改一" }] },
            { type: "paragraph", content: [{ type: "text", text: "修改二" }] },
          ],
        })
      }
    >
      模拟修改多处
    </button>
  ),
}));

const fullContent = {
  type: "doc" as const,
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "第一章" }],
    },
    { type: "paragraph", content: [{ type: "text", text: "原文一" }] },
    { type: "paragraph", content: [{ type: "text", text: "原文二" }] },
  ],
};

function renderEditor() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ChapterSuggestionEditor
        documentId="demo-post"
        baseRevision={7}
        chapterId="chapter-0"
        chapterTitle="第一章"
        chapterIndex={0}
        fullContent={fullContent}
        chapterContent={fullContent}
      />
    </QueryClientProvider>,
  );
}

describe("ChapterSuggestionEditor", () => {
  it("把整章多处修改合并成一个批次提交", async () => {
    mocks.submitSuggestionBatch.mockReset().mockResolvedValue({ id: "batch-1" });
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "整章修订" }));
    expect(
      screen.getByRole("button", { name: "合并提交全部修改" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "模拟修改多处" }));
    fireEvent.change(screen.getByLabelText("整体说明"), {
      target: { value: "一次修改两处" },
    });
    fireEvent.click(screen.getByRole("button", { name: "合并提交全部修改" }));

    await waitFor(() => expect(mocks.submitSuggestionBatch).toHaveBeenCalledOnce());
    const [, input] = mocks.submitSuggestionBatch.mock.calls[0]!;
    expect(input).toMatchObject({
      baseRevision: 7,
      chapterId: "chapter-0",
      chapterTitle: "第一章",
      reason: "一次修改两处",
    });
    expect(input.steps.length).toBeGreaterThan(1);
    expect(input.afterContent.content[1].content[0].text).toBe("修改一");
  });
});
