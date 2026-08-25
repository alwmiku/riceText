import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProofreadView } from "./ProofreadView";
import type { ForumSuggestion } from "../../lib/api";

const suggestion = (
  overrides: Partial<ForumSuggestion>,
): ForumSuggestion => ({
  id: "s1",
  documentId: "demo-post",
  chapterId: "chapter-0",
  chapterTitle: "楔子 · 雨季之前",
  lineNo: 2,
  lineText: "雨季开始前的第七天，港口送走了最后一班客船。雾线从海面爬上来，把整条长街泡得发软。",
  fromText: "雾线从海面爬上来",
  toText: "雾气从海面爬上来",
  reason: "“雾线”非惯用说法，建议改为“雾气”",
  status: "pending",
  authorId: "reader",
  reviewerId: null,
  createdAt: "2026-08-20T08:00:00.000Z",
  ...overrides,
});

const lines = [
  "楔子 · 雨季之前",
  "雨季开始前的第七天，港口送走了最后一班客船。雾线从海面爬上来，把整条长街泡得发软。",
  "邮差在码头边捡到一封没有署名、也没有邮票的信。",
];

function renderView(overrides?: {
  suggestions?: readonly ForumSuggestion[];
  lines?: readonly string[];
}) {
  const onExit = vi.fn();
  const result = render(
    <ProofreadView
      documentTitle="雾港来信"
      chapterTitle="楔子 · 雨季之前"
      lines={overrides?.lines ?? lines}
      suggestions={overrides?.suggestions ?? [suggestion({})]}
      onExit={onExit}
    />,
  );
  return { onExit, container: result.container };
}

describe("ProofreadView", () => {
  it("标明文章与章节，未修改行单行展示并带行号", () => {
    renderView();
    expect(
      screen.getByText("校订《雾港来信》· 楔子 · 雨季之前"),
    ).toBeInTheDocument();
    expect(screen.getByText("楔子 · 雨季之前")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(
      screen.getByText("邮差在码头边捡到一封没有署名、也没有邮票的信。"),
    ).toBeInTheDocument();
  });

  it("修改片段呈上下两行：原文在上、校订后在下，按字高亮并与上下文混排", () => {
    const { container } = renderView();
    // 原文行：只有真正变化的“线”字带删除高亮（雾 为公共字）
    const deleted = container.querySelector('[data-diff="delete"]');
    expect(deleted?.textContent).toBe("线");
    // 校订后行：只有“气”字带插入高亮
    const inserted = container.querySelector('[data-diff="insert"]');
    expect(inserted?.textContent).toBe("气");
    // 未变化的文字与修改片段在同一行混排（上下两行都保留上下文）
    expect(container.textContent).toContain("雨季开始前的第七天，港口送走了最后一班客船。");
    expect(container.textContent).toContain("从海面爬上来");
    // 修改行号与校订说明
    expect(screen.getByText("第 2 行")).toBeInTheDocument();
    expect(
      screen.getByText(/“雾线”非惯用说法，建议改为“雾气”/),
    ).toBeInTheDocument();
  });

  it("行号不匹配的行不显示任何校订变化", () => {
    const { container } = renderView({
      suggestions: [
        suggestion({ lineNo: 9, fromText: "雾线", toText: "雾气" }),
      ],
    });
    // 第 2 行仍是单行文本，没有 delete/insert 高亮
    expect(container.querySelector('[data-diff]')).toBeNull();
    expect(
      screen.getByText("雨季开始前的第七天，港口送走了最后一班客船。雾线从海面爬上来，把整条长街泡得发软。"),
    ).toBeInTheDocument();
    expect(screen.getByText("本章暂无校订")).toBeInTheDocument();
  });

  it("无校订时显示空态并全部单行渲染", () => {
    const { container } = renderView({ suggestions: [] });
    expect(screen.getByText("本章暂无校订")).toBeInTheDocument();
    expect(container.querySelector('[data-diff]')).toBeNull();
  });

  it("点击退出校订触发回调", () => {
    const { onExit } = renderView();
    fireEvent.click(screen.getByRole("button", { name: /退出校订/ }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("多行校订时列出所有涉及行", () => {
    renderView({
      suggestions: [
        suggestion({ id: "s1", lineNo: 1, fromText: "楔子", toText: "序章" }),
        suggestion({ id: "s2", lineNo: 3, fromText: "邮差", toText: "邮递员" }),
      ],
    });
    expect(screen.getByText(/涉及行：第 1、3 行/)).toBeInTheDocument();
  });
});
