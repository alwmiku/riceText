import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createEditorExtensions, editorExtensions } from "./editor.js";
import { schemaExtensions } from "./schema.js";
import { createViewerExtensions } from "./viewer.js";
import type { ViewerContextRef } from "../viewer/types.js";

const viewerRef = {
  current: {} as ViewerContextRef["current"],
  subscribe: () => () => undefined,
} satisfies ViewerContextRef;

function extensionNames(extensions: ReturnType<typeof schemaExtensions>): string[] {
  return extensions.map((extension) => extension.name);
}

function schemaNames(extensions: ReturnType<typeof schemaExtensions>) {
  const schema = getSchema(extensions);
  return {
    nodes: Object.keys(schema.nodes).sort(),
    marks: Object.keys(schema.marks).sort(),
  };
}

describe("extension compositions", () => {
  it("adds editor-only behavior to the canonical schema extensions", () => {
    const canonicalNames = extensionNames(schemaExtensions());

    expect(extensionNames(createEditorExtensions())).toEqual([
      ...canonicalNames,
      "formatPainter",
      "sharedClipboard",
      "spoilerOverlay",
    ]);
    // spoilerOverlay 只做渲染，不属于持久化 schema，因此追加在规范扩展之后，
    // 编辑器与只读查看器各挂一次。
    expect(extensionNames(createViewerExtensions(viewerRef))).toEqual([
      ...canonicalNames,
      "spoilerOverlay",
    ]);
  });

  it("keeps schema, editor, and viewer persisted node and mark names in parity", () => {
    const canonicalSchema = schemaNames(schemaExtensions());

    expect(schemaNames(createEditorExtensions())).toEqual(canonicalSchema);
    expect(schemaNames(createViewerExtensions(viewerRef))).toEqual(canonicalSchema);
  });

  it("keeps editorExtensions as a compatibility alias", () => {
    expect(editorExtensions).toBe(createEditorExtensions);
  });
});
