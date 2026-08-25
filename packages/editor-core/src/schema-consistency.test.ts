import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { createDocumentSchema } from "@ricetext/document-core";
import { editorExtensions } from "./extensions/index.js";

/** 服务端（document-core）与编辑器（editor-core）的 schema 必须完全一致。 */
describe("schema consistency", () => {
  it("editorExtensions 与 createDocumentSchema 产生相同 schema", () => {
    const editorSchema = getSchema(editorExtensions());
    const serverSchema = createDocumentSchema();

    // 节点/标记注册顺序允许不同，但名称集合与每个 NodeType.spec 必须一致。
    const summarize = (schema: {
      nodes: Record<string, { spec: unknown }>;
      marks: Record<string, { spec: unknown }>;
    }) => ({
      nodes: Object.keys(schema.nodes)
        .sort()
        .map((name) => [name, JSON.stringify(schema.nodes[name]!.spec)]),
      marks: Object.keys(schema.marks)
        .sort()
        .map((name) => [name, JSON.stringify(schema.marks[name]!.spec)]),
    });

    expect(summarize(serverSchema)).toEqual(summarize(editorSchema));
  });
});
