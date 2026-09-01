import { describe, expect, it, vi } from "vitest";

import type { ViewerContextRef } from "../viewer/types.js";

const { editorFactory } = vi.hoisted(() => ({
  editorFactory: vi.fn(() => {
    throw new Error("viewer called the editor factory");
  }),
}));

vi.mock("./editor.js", () => ({
  createEditorExtensions: editorFactory,
  editorExtensions: editorFactory,
}));

import { createViewerExtensions } from "./viewer.js";

const viewerRef = {
  current: {} as ViewerContextRef["current"],
  subscribe: () => () => undefined,
} satisfies ViewerContextRef;

describe("viewer composition dependency", () => {
  it("does not derive from the editor factory", () => {
    expect(() => createViewerExtensions(viewerRef)).not.toThrow();
    expect(editorFactory).not.toHaveBeenCalled();
  });
});
