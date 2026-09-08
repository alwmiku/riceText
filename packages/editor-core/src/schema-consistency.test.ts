import { describe, expect, it } from "vitest";
import { Extension, getSchema } from "@tiptap/core";
import { createDocumentExtensions, createDocumentSchema } from "@ricetext/document-core";
import { createEditorExtensions, editorExtensions, schemaExtensions } from "./extensions/index.js";
import { createViewerExtensions } from "./extensions/viewer.js";
import type { ViewerContextRef } from "./viewer/types.js";

const viewerRef = { current: {} as ViewerContextRef["current"], subscribe: () => () => undefined };
const compositions = {
  schema: () => schemaExtensions(),
  editor: () => createEditorExtensions(),
  resizableEditor: () => createEditorExtensions({ resizableImages: true }),
  viewer: () => createViewerExtensions(viewerRef),
};

/** 比较持久化结构；函数形式的 HTML 和 NodeView 实现不属于持久化规格。 */
function summarize(schema: ReturnType<typeof getSchema>) {
  return {
    nodes: Object.entries(schema.nodes).map(([name, type]) => [
      name,
      JSON.parse(JSON.stringify(type.spec)),
    ]),
    marks: Object.entries(schema.marks).map(([name, type]) => [
      name,
      JSON.parse(JSON.stringify(type.spec)),
    ]),
  };
}

describe("schema 一致性", () => {
  it.each(Object.entries(compositions))(
    "%s 保留所有持久化属性、默认值和内容约束",
    (_name, extensions) => {
      expect(summarize(getSchema(extensions()))).toEqual(summarize(createDocumentSchema()));
    },
  );

  it("遵循 document-core 扩展顺序，且每项增强仅添加一次", () => {
    const canonical = createDocumentExtensions().map((extension) => extension.name);
    for (const extensions of [schemaExtensions(), createViewerExtensions(viewerRef)]) {
      expect(extensions.map((extension) => extension.name)).toEqual(canonical);
    }
    const names = editorExtensions().map((extension) => extension.name);
    expect(names).toEqual([...canonical, "formatPainter", "sharedClipboard"]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("保留公开工厂别名和附加扩展顺序", () => {
    const extra = Extension.create({ name: "applicationBehavior" });
    expect(editorExtensions).toBe(createEditorExtensions);
    for (const factory of [
      createDocumentExtensions,
      schemaExtensions,
      createEditorExtensions,
      editorExtensions,
    ]) {
      expect(factory({ additionalExtensions: [extra] }).at(-1)).toBe(extra);
    }
  });
});
