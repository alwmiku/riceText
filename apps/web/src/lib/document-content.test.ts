import { describe, expect, it } from "vitest";
import { toEditorContent } from "./document-content";
import { toChapterDocument } from "./api/chapters";

describe("章节正文边界", () => {
  it("递归移除显式 undefined 的可选字段，并保留富节点与标记", () => {
    const input = { type: "doc", content: [{ type: "paragraph", attrs: undefined, content: [{
      type: "text", text: "正文", content: undefined, marks: [{ type: "bold", attrs: undefined }],
    }] }] };
    const adapted = toEditorContent(input);
    expect(adapted).toEqual({ type: "doc", content: [{ type: "paragraph", content: [{
      type: "text", text: "正文", marks: [{ type: "bold" }],
    }] }] });
    expect(toChapterDocument(adapted)).toEqual(adapted);
    expect(input.content[0]).toHaveProperty("attrs");
  });

  it("发送前校验编辑器输入，并补齐契约规定的空正文默认值", () => {
    expect(toChapterDocument({ type: "doc" })).toEqual({ type: "doc", content: [] });
    expect(() => toChapterDocument({ type: "paragraph" })).toThrow();
    expect(() => toChapterDocument({ type: "doc", content: [{ text: "missing node type" }] })).toThrow();
    expect(() => toChapterDocument({ type: "doc", content: [{ type: "paragraph", attrs: { invalid: () => 1 } }] })).toThrow();
  });
});
