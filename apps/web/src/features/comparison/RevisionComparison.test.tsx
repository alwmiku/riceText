import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RichTextNode } from "../../lib/types";
import {
  RevisionComparison,
  buildRevisionComparison,
} from "./RevisionComparison";

const paragraph = (mark?: string): RichTextNode => ({
  type: "paragraph",
  content: [
    {
      type: "text",
      text: "格式变化但文字相同",
      ...(mark ? { marks: [{ type: mark }] } : {}),
    },
  ],
});

describe("RevisionComparison", () => {
  it("未变化块只保留一次，变化块按历史和当前顺序合并", () => {
    const result = buildRevisionComparison(
      { type: "doc", content: [paragraph(), paragraph("bold")] },
      { type: "doc", content: [paragraph(), paragraph("italic")] },
    );
    expect(result.changedBlocks).toBe(1);
    expect(result.tones).toEqual(["unchanged", "history", "current"]);
    expect(result.content.content).toHaveLength(3);
  });

  it("在一个只读 ProseMirror 中渲染历史与当前的真实格式", async () => {
    const { container } = render(
      <RevisionComparison
        historicalRevision={17}
        chapterTitle="第一章"
        historicalContent={{ type: "doc", content: [paragraph("bold")] }}
        currentContent={{ type: "doc", content: [paragraph("italic")] }}
        onExit={vi.fn()}
      />,
    );
    expect(screen.getByText("1 处内容块变化")).toBeInTheDocument();
    await waitFor(() =>
      expect(container.querySelectorAll(".ProseMirror")).toHaveLength(1),
    );
    expect(
      container.querySelector('[data-version-side="history"] strong'),
    ).toHaveTextContent("格式变化但文字相同");
    expect(
      container.querySelector('[data-version-side="current"] em'),
    ).toHaveTextContent("格式变化但文字相同");
  });
});
