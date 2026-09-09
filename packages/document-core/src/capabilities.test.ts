import { Node } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import {
  REVISION_SURFACE_ATTRIBUTE,
  capabilitiesOfSpec,
  chromeSurface,
  effectiveRevisionSurface,
  revisionCapabilityOfSpec,
} from "./capabilities.js";
import { createDocumentSchema } from "./schema.js";

/** 第三方行内原子：显式声明为正文，覆盖「原子默认装饰」的派生。 */
const DeclaredProseAtom = Node.create({
  name: "declaredProseAtom",
  group: "inline",
  inline: true,
  atom: true,
  capabilities: {
    revision: { surface: "prose" },
    text: { leafText: (node) => String(node.attrs.label ?? "") },
  },
});

/** 第三方块节点：未声明修订面，用于验证声明缺失时不会出错。 */
const UndeclaredBlock = Node.create({
  name: "undeclaredBlock",
  group: "block",
  content: "block+",
});

describe("扩展能力契约", () => {
  it("装饰区域统一使用修订面属性", () => {
    expect(chromeSurface()).toEqual({ [REVISION_SURFACE_ATTRIBUTE]: "chrome" });
  });

  it("未声明的原子默认装饰，其余默认正文", () => {
    expect(effectiveRevisionSurface({}, true)).toBe("chrome");
    expect(effectiveRevisionSurface({}, false)).toBe("prose");
    expect(effectiveRevisionSurface(undefined, true)).toBe("chrome");
    expect(effectiveRevisionSurface(null, false)).toBe("prose");
  });

  it("显式声明覆盖默认派生", () => {
    expect(
      effectiveRevisionSurface({ capabilities: { revision: { surface: "prose" } } }, true),
    ).toBe("prose");
    expect(
      effectiveRevisionSurface({ capabilities: { revision: { surface: "chrome" } } }, false),
    ).toBe("chrome");
  });

  it("非对象或缺少声明时安全返回", () => {
    expect(capabilitiesOfSpec(undefined)).toBeUndefined();
    expect(capabilitiesOfSpec("text")).toBeUndefined();
    expect(capabilitiesOfSpec({})).toBeUndefined();
    expect(capabilitiesOfSpec({ capabilities: null })).toBeUndefined();
    expect(revisionCapabilityOfSpec({ capabilities: {} })).toBeUndefined();
  });

  it("规范 schema 注入每个现有扩展的声明", () => {
    const schema = createDocumentSchema();
    for (const name of [
      "richImage",
      "diceRoll",
      "mention",
      "attachmentRef",
      "pollRef",
      "inlineCommentAnchor",
      "longTextBlock",
    ]) {
      expect(revisionCapabilityOfSpec(schema.nodes[name]!.spec), name).toEqual({
        surface: "chrome",
      });
    }
    for (const name of ["novelExcerpt", "replyGate"]) {
      expect(revisionCapabilityOfSpec(schema.nodes[name]!.spec), name).toEqual({
        surface: "prose",
      });
    }
    expect(revisionCapabilityOfSpec(schema.marks.spoiler!.spec)).toEqual({
      surface: "prose",
      domSelector: '[data-spoiler="true"]',
      proseWhen: '[aria-expanded="true"]',
    });
  });

  it("文本投影能力随规格可用", () => {
    const schema = createDocumentSchema();
    const leafText = (name: string, attrs: Record<string, unknown>) => {
      const node = schema.nodes[name]!.create(attrs);
      return capabilitiesOfSpec(node.type.spec)?.text?.leafText?.(node);
    };
    expect(leafText("mention", { name: "小明" })).toBe("@小明");
    expect(leafText("diceRoll", { expression: "2d6", total: 7 })).toBe("2d6 = 7");
    expect(leafText("attachmentRef", { name: "附件.txt" })).toBe("附件.txt");
    expect(leafText("inlineCommentAnchor", { count: 12 })).toBe("12");
    expect(leafText("longTextBlock", { text: "长文" })).toBe("长文");
    expect(leafText("richImage", { alt: "替代文本", caption: "图注" })).toBe("替代文本\n图注");
    expect(
      leafText("pollRef", {
        question: "问题",
        options: [
          { id: "a", label: "选项 A" },
          { id: "b", label: "选项\nB" },
        ],
      }),
    ).toBe("问题\n选项 A\n选项\nB");
  });

  it("第三方扩展的声明同样被注入，未声明的扩展不产生字段", () => {
    const schema = createDocumentSchema({
      additionalExtensions: [DeclaredProseAtom, UndeclaredBlock],
    });
    expect(revisionCapabilityOfSpec(schema.nodes.declaredProseAtom!.spec)).toEqual({
      surface: "prose",
    });
    expect(capabilitiesOfSpec(schema.nodes.declaredProseAtom!.spec)?.text).toBeDefined();
    expect(capabilitiesOfSpec(schema.nodes.undeclaredBlock!.spec)).toBeUndefined();
  });
});
