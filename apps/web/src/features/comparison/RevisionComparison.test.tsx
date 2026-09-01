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

  it("插入内容块不会让后续分割线和段落错位", () => {
    const stable = paragraph();
    const divider: RichTextNode = { type: "horizontalRule" };
    const ending: RichTextNode = {
      type: "paragraph",
      content: [{ type: "text", text: "结尾" }],
    };
    const inserted: RichTextNode = {
      type: "paragraph",
      content: [{ type: "text", text: "新增" }],
    };
    const result = buildRevisionComparison(
      { type: "doc", content: [stable, divider, ending] },
      { type: "doc", content: [stable, inserted, divider, ending] },
    );
    expect(result.changedBlocks).toBe(1);
    expect(result.tones).toEqual([
      "unchanged",
      "current",
      "unchanged",
      "unchanged",
    ]);
    expect(result.content.content).toEqual([stable, inserted, divider, ending]);
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
    expect(screen.queryByText("当前版本")).not.toBeInTheDocument();
  });

  it("功能节点保留真实渲染并获得可见的比较背景", async () => {
    const functional = (suffix: string): RichTextNode => ({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "链接" + suffix,
              marks: [{ type: "link", attrs: { href: "https://example.com/" + suffix } }],
            },
            {
              type: "diceRoll",
              attrs: { rollId: "roll-" + suffix, expression: "1d6", rolls: [suffix === "old" ? 2 : 5], total: suffix === "old" ? 2 : 5, rerollOf: null },
            },
          ],
        },
        { type: "horizontalRule", ...(suffix === "new" ? { attrs: {} } : {}) },
        { type: "attachmentRef", attrs: { attachmentId: "file-" + suffix, name: suffix + ".txt", mimeType: "text/plain", size: 512, priceCoins: 0 } },
        { type: "pollRef", attrs: { pollId: "poll-" + suffix, question: "选择" + suffix, multiple: false, options: [{ id: "one", label: "选项" + suffix }] } },
        { type: "richImage", attrs: { assetId: "image-" + suffix, src: "/uploads/" + suffix + ".png", alt: "图片" + suffix, caption: suffix, align: "center", width: 60 } },
      ],
    });
    const { container } = render(
      <RevisionComparison
        historicalRevision={8}
        chapterTitle="功能节点"
        historicalContent={functional("old")}
        currentContent={functional("new")}
        onExit={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(container.querySelectorAll(".ProseMirror")).toHaveLength(1),
    );
    expect(container.querySelectorAll('[data-node-type="horizontalRule"]')).toHaveLength(2);
    expect(container.querySelector('[data-node-type="horizontalRule"]')).toHaveStyle({ height: "40px" });
    expect(container.querySelectorAll('[data-node-type="attachmentRef"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-node-type="pollRef"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-node-type="richImage"]')).toHaveLength(2);
    expect(container.querySelector('[data-version-side="history"] a')).toHaveTextContent("链接old");
    expect(container.querySelector('[data-version-side="current"] a')).toHaveTextContent("链接new");
    expect(container.querySelector('[data-version-side="history"]')).not.toHaveAttribute("data-version-label");
    expect(container.querySelector('[data-version-side="current"]')).not.toHaveAttribute("data-version-label");
  });
});
