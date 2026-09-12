import { describe, expect, it } from "vitest";
import {
  DOCUMENT_MARK_ATTRIBUTES,
  DOCUMENT_NODE_ATTRIBUTES,
  TiptapDocumentSchema,
} from "@ricetext/contracts";
import { createDocumentSchema } from "./schema.js";
import { validateDocument } from "./sanitize.js";

const schema = createDocumentSchema();

describe("持久化 schema 规则", () => {
  it("与独立契约中的属性白名单完全一致", () => {
    for (const [types, policy] of [
      [schema.nodes, DOCUMENT_NODE_ATTRIBUTES],
      [schema.marks, DOCUMENT_MARK_ATTRIBUTES],
    ] as const) {
      expect(Object.keys(types).sort()).toEqual(Object.keys(policy).sort());
      for (const [name, attrs] of Object.entries(policy)) {
        expect(Object.keys(types[name]!.spec.attrs ?? {}).sort(), name).toEqual([...attrs].sort());
      }
    }
  });

  it("明确保留内容表达式和标记互斥规则", () => {
    expect(
      Object.fromEntries(
        Object.entries(schema.nodes).map(([name, node]) => [name, node.spec.content ?? ""]),
      ),
    ).toEqual({
      doc: "block+",
      paragraph: "inline*",
      text: "",
      heading: "inline*",
      bulletList: "listItem+",
      orderedList: "listItem+",
      listItem: "paragraph block*",
      blockquote: "block+",
      codeBlock: "text*",
      hardBreak: "",
      horizontalRule: "",
      richImage: "",
      diceRoll: "",
      novelExcerpt: "block+",
      mention: "",
      replyGate: "block+",
      attachmentRef: "",
      pollRef: "",
      longTextBlock: "",
      inlineCommentAnchor: "",
      emoji: "",
    });
    expect(schema.nodes.codeBlock!.spec.marks).toBe("");
    expect(schema.marks.spoiler!.spec).toMatchObject({
      inclusive: false,
      excludes: "bold italic textStyle",
    });
    for (const name of [
      "richImage",
      "diceRoll",
      "mention",
      "attachmentRef",
      "pollRef",
      "longTextBlock",
      "inlineCommentAnchor",
      "emoji",
    ]) {
      expect(schema.nodes[name]!.isAtom, name).toBe(true);
      expect(schema.nodes[name]!.createAndFill()!.childCount, name).toBe(0);
    }
    for (const name of ["novelExcerpt", "replyGate"]) {
      expect(schema.nodes[name]!.spec, name).toMatchObject({ defining: true, isolating: true });
    }
  });

  it.each([
    { type: "doc", content: [{ type: "text", text: "inline root" }] },
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "richImage" }] }] },
    {
      type: "doc",
      content: [{ type: "novelExcerpt", content: [{ type: "text", text: "inline excerpt" }] }],
    },
    {
      type: "doc",
      content: [{ type: "replyGate", content: [{ type: "text", text: "inline gate" }] }],
    },
    { type: "doc", content: [{ type: "orderedList", content: [{ type: "paragraph" }] }] },
    { type: "doc", content: [{ type: "richImage", content: [{ type: "paragraph" }] }] },
  ])("schema 和校验器均拒绝非法子内容", (doc) => {
    expect(() => schema.nodeFromJSON(doc).check()).toThrow();
    const result = validateDocument(doc);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "invalid-structure" }));
  });

  it("保留持久化默认值，包括 null 和空值", () => {
    const defaults = (name: string) => schema.nodes[name]!.createAndFill()!.attrs;
    expect(defaults("paragraph")).toEqual({ textAlign: null, firstLineIndent: 0, leftIndent: 0 });
    expect(defaults("heading")).toEqual({
      textAlign: null,
      chapterStart: false,
      firstLineIndent: 0,
      leftIndent: 0,
      level: 1,
    });
    expect(defaults("orderedList")).toEqual({ start: 1, type: null });
    expect(defaults("codeBlock")).toEqual({ language: null });
    expect(defaults("richImage")).toEqual({
      assetId: null,
      src: "",
      alt: "",
      caption: "",
      align: "center",
      width: 100,
    });
    expect(defaults("novelExcerpt")).toEqual({
      bookTitle: "",
      chapterTitle: "",
      author: "",
      sourceUrl: null,
      variant: "fanqie",
      readerTime: "",
      batteryLevel: 100,
      pageLabel: "1/1",
      progressLabel: "",
      headerLabel: "",
    });
    expect(defaults("longTextBlock")).toEqual({
      chapterId: "",
      title: "",
      volumeTitle: "",
      text: "",
      order: 0,
      start: null,
      end: null,
    });
    expect(schema.marks.link!.create().attrs).toEqual({
      href: null,
      target: "_blank",
      rel: "noopener noreferrer nofollow",
    });
    expect(schema.marks.textStyle!.create().attrs).toEqual({
      color: null,
      fontFamily: null,
      fontSize: null,
    });
  });

  it.each(Object.keys(DOCUMENT_NODE_ATTRIBUTES))(
    "拒绝 %s 上的未知属性，即使其值为 null",
    (name) => {
      const node = name === "text" ? schema.text("text") : schema.nodes[name]!.createAndFill()!;
      const json = node.toJSON();
      json.attrs = { ...json.attrs, unexpected: null };
      const content = node.isInline
        ? [{ type: "paragraph", content: [json] }]
        : name === "listItem"
          ? [{ type: "bulletList", content: [json] }]
          : [json];
      const input = name === "doc" ? json : { type: "doc", content };
      const result = validateDocument(input);
      expect(result.valid).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: "unknown-attribute",
          path: expect.stringContaining(".attrs.unexpected"),
        }),
      );
    },
  );

  it.each(Object.keys(DOCUMENT_MARK_ATTRIBUTES))("拒绝 %s 标记上的未知属性", (name) => {
    const attrs = {
      ...(name === "link" ? { href: "https://example.com/" } : {}),
      unexpected: null,
    };
    const result = validateDocument({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "text", marks: [{ type: name, attrs }] }],
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "unknown-attribute",
        path: "$.content[0].content[0].marks[0].attrs.unexpected",
      }),
    );
  });
  it.each([null, 1, true, {}, [], "x".repeat(501)])(
    "在两个校验边界均拒绝非法卷名 %j",
    (volumeTitle) => {
      const doc = { type: "doc", content: [{ type: "longTextBlock", attrs: { volumeTitle } }] };
      expect(TiptapDocumentSchema.safeParse(doc).success).toBe(false);
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: "invalid-attribute",
          path: "$.content[0].attrs.volumeTitle",
        }),
      );
    },
  );

  it.each([undefined, "", "卷名", "x".repeat(500)])(
    "仅接受严格符合旧版兼容规则或长度限制的字符串卷名",
    (volumeTitle) => {
      const doc = {
        type: "doc",
        content: [
          { type: "longTextBlock", attrs: volumeTitle === undefined ? {} : { volumeTitle } },
        ],
      };
      expect(TiptapDocumentSchema.safeParse(doc).success).toBe(true);
      expect(validateDocument(doc).valid).toBe(true);
      expect(
        validateDocument({
          type: "doc",
          content: [
            { type: "longTextBlock", attrs: { ...doc.content[0]!.attrs, unexpected: null } },
          ],
        }).valid,
      ).toBe(false);
    },
  );
});
