import { describe, expect, it } from "vitest";
import { emojiAssetPath } from "@ricetext/contracts";
import type { DocumentValidationResult } from "./types.js";
import { sanitizeDocument, validateDocument } from "./sanitize.js";

const paragraph = (content: unknown[]) => ({
  type: "doc",
  content: [{ type: "paragraph", content }],
});

/**
 * 取出段落里第一个行内节点的 attrs；净化结果始终落在这个位置。
 * `JSONContent` 已经把 attrs 标成可选，这里用非空断言收窄，测试里读起来更直接。
 */
function firstInlineAttrs(result: DocumentValidationResult): Record<string, any> {
  const attrs = result.document.content?.[0]?.content?.[0]?.attrs;
  if (!attrs) throw new Error("净化结果里没有行内节点属性");
  return attrs;
}

/** 自定义表情节点：src 由目录派生，正文里出现的 src 只是渲染缓存。 */
describe("emoji 节点的净化规则", () => {
  it("合法节点透传，src 被改写为目录路径", () => {
    const result = validateDocument(
      paragraph([
        {
          type: "emoji",
          attrs: {
            emojiId: "hug",
            name: "微笑",
            src: "https://evil.example.com/tracker.png",
            fallback: "🙂",
          },
        },
      ]),
    );
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.document).toEqual({
      type: "doc",
      content: [
        {
          // 段落会被补齐归一化属性（对齐与首行/左侧缩进），这里一并固化。
          type: "paragraph",
          attrs: { firstLineIndent: 0, leftIndent: 0, textAlign: "left" },
          content: [
            {
              type: "emoji",
              attrs: {
                emojiId: "hug",
                name: "微笑",
                src: emojiAssetPath("hug"),
                fallback: "🙂",
              },
            },
          ],
        },
      ],
    });
  });

  it("伪造的 src 被目录值替换，且不产生 issue", () => {
    const result = validateDocument(
      paragraph([{ type: "emoji", attrs: { emojiId: "water", src: "javascript:alert(1)" } }]),
    );
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(firstInlineAttrs(result).src).toBe(emojiAssetPath("water"));
  });

  it("未知 emojiId 保留原值并保留合法 src，避免表情包下线后老正文无法保存", () => {
    const result = validateDocument(
      paragraph([
        {
          type: "emoji",
          attrs: {
            emojiId: "retired-emoji",
            name: "旧表情",
            src: "/api/emoji/retired-emoji/image",
            fallback: "x",
          },
        },
      ]),
    );
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(firstInlineAttrs(result)).toEqual({
      emojiId: "retired-emoji",
      name: "旧表情",
      src: "/api/emoji/retired-emoji/image",
      fallback: "x",
    });
  });

  it("未知 emojiId 搭配不安全 src 时清空 src 并报告 unsafe-url", () => {
    const result = validateDocument(
      paragraph([
        { type: "emoji", attrs: { emojiId: "retired-emoji", src: "data:image/svg+xml,<svg/>" } },
      ]),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("unsafe-url");
    expect(firstInlineAttrs(result).src).toBe("");
  });

  it("白名单外的属性被移除并报告 unknown-attribute", () => {
    const result = validateDocument(
      paragraph([{ type: "emoji", attrs: { emojiId: "hug", href: "https://example.com" } }]),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("unknown-attribute");
    const attrs = firstInlineAttrs(result);
    expect(Object.keys(attrs)).toEqual(["emojiId", "name", "src", "fallback"]);
    expect(attrs.href).toBeUndefined();
  });

  it("块级位置上的 emoji 属于非法结构", () => {
    const result = validateDocument({
      type: "doc",
      content: [{ type: "emoji", attrs: { emojiId: "hug" } }],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("invalid-structure");
    expect((result.document.content ?? []).some((node) => node.type === "emoji")).toBe(false);
  });

  it("原子节点不允许携带子内容，且遵守节点数量上限", () => {
    const withChildren = validateDocument(
      paragraph([
        { type: "emoji", attrs: { emojiId: "hug" }, content: [{ type: "text", text: "嵌套" }] },
      ]),
    );
    expect(withChildren.valid).toBe(false);
    expect(withChildren.issues.map((issue) => issue.code)).toContain("invalid-structure");
    expect(sanitizeDocument(withChildren.document)).toEqual(withChildren.document);
  });

  it("超长属性按上限截断，避免把任意长度字符串写进正文", () => {
    const result = validateDocument(
      paragraph([
        {
          type: "emoji",
          attrs: {
            emojiId: "hug",
            name: "名".repeat(80),
            fallback: "字".repeat(40),
          },
        },
      ]),
    );
    const attrs = firstInlineAttrs(result);
    expect(String(attrs.name)).toHaveLength(40);
    expect(String(attrs.fallback)).toHaveLength(16);
  });
});
