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
  it("keeps schema, editor, and viewer extension names in parity", () => {
    const canonicalNames = extensionNames(schemaExtensions());

    expect(extensionNames(createEditorExtensions())).toEqual(canonicalNames);
    expect(extensionNames(createViewerExtensions(viewerRef))).toEqual(canonicalNames);
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
