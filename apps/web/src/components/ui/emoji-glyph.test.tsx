import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { findEmojiEntry } from "@ricetext/contracts";
import { EmojiGlyph } from "./emoji-glyph";

describe("EmojiGlyph", () => {
  it("自定义表情渲染成固定尺寸的图片，并带上名称作为 alt/title", () => {
    render(<EmojiGlyph entry={findEmojiEntry("hug")!} size={30} />);
    const image = screen.getByRole("img", { name: "抱抱" });
    expect(image.tagName).toBe("IMG");
    // 面板里用静态首帧缩略图，正文才用完整动图。
    expect(image).toHaveAttribute("src", "/api/emoji/hug/image?frame=first");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("draggable", "false");
    expect(image.getAttribute("style")).toContain("30px");
  });

  it("animated 时改用完整动图（正文渲染路径）", () => {
    render(<EmojiGlyph entry={findEmojiEntry("hug")!} size={22} animated />);
    expect(screen.getByRole("img", { name: "抱抱" })).toHaveAttribute(
      "src",
      "/api/emoji/hug/image",
    );
  });

  it("纯文本表情直接渲染字符，尺寸换算成字号", () => {
    render(<EmojiGlyph entry={findEmojiEntry("smile")!} size={24} />);
    const glyph = screen.getByRole("img", { name: "微笑" });
    expect(glyph.tagName).toBe("SPAN");
    expect(glyph).toHaveTextContent("😀");
    expect(glyph.getAttribute("style")).toContain("font-size: 20px");
  });

  it("图片加载失败时降级为 fallback 文本", () => {
    render(<EmojiGlyph entry={findEmojiEntry("water")!} size={22} className="extra" />);
    const image = screen.getByRole("img", { name: "浇水" });
    fireEvent.error(image);
    const fallback = screen.getByRole("img", { name: "浇水" });
    expect(fallback.tagName).toBe("SPAN");
    expect(fallback).toHaveTextContent("💧");
    expect(fallback).toHaveClass("extra");
  });
});
