import { RichTextViewer, type JSONContent } from "@ricetext/editor-core";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { defaultDocument } from "../../lib/seed";

beforeAll(() => {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () { /* empty */ } }),
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 0, 0, 0),
  });
});

describe("RichTextViewer", () => {
  it("渲染静态正文且不创建编辑面板", async () => {
    const { container } = render(
      <RichTextViewer content={defaultDocument.content as JSONContent} />,
    );
    await screen.findByText("雾港来信：第三章讨论与校订");
    expect(
      container.querySelector('[contenteditable="true"]'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    const dice = screen.getByTitle("4 + 3 + 5");
    expect(dice).toHaveTextContent("3d5");
    expect(dice).toHaveTextContent("12");
  });

  it("读者未回复时隐藏回复可见内容", async () => {
    render(
      <RichTextViewer
        content={defaultDocument.content as JSONContent}
        interactions={{ isReplyGateVisible: () => false }}
      />,
    );
    await screen.findByText("回复主题后显示本段航海日志。");
    expect(screen.queryByText(/日志坐标/)).not.toBeInTheDocument();
  });

  it("黑幕可通过点击切换揭示状态", async () => {
    render(
      <RichTextViewer content={defaultDocument.content as JSONContent} />,
    );
    const spoiler = await screen.findByText(
      "这一句包含结局线索，请谨慎查看。",
    );
    expect(spoiler).not.toHaveClass("rt-spoiler--revealed");
    fireEvent.click(spoiler);
    expect(spoiler).toHaveClass("rt-spoiler--revealed");
  });
});
