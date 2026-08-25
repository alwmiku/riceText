import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDocument } from "../../lib/seed";
import type { DocumentEnvelope, RichTextNode } from "../../lib/types";
import { useComposeDocument } from "./useComposeDocument";

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  restoreRevision: vi.fn(),
  autosave: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  getDocument: mocks.getDocument,
  restoreRevision: mocks.restoreRevision,
}));
vi.mock("../editor/useAutosave", () => ({ useAutosave: mocks.autosave }));

const serverDocument: DocumentEnvelope = {
  ...defaultDocument,
  revision: 1,
  content: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "第一章 潮汐表" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "服务器正文" }] },
    ],
  },
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useComposeDocument hydration", () => {
  beforeEach(() => {
    mocks.getDocument.mockReset().mockResolvedValue(serverDocument);
    mocks.restoreRevision.mockReset();
    mocks.autosave.mockReset().mockReturnValue({
      state: "saved",
      revision: defaultDocument.revision,
      savedAt: defaultDocument.savedAt,
      conflictMessage: "",
      flush: vi.fn().mockResolvedValue(true),
      acceptLatest: vi.fn(),
    });
  });

  it("hydrates server content even when placeholder metadata has a higher revision", async () => {
    const { result } = renderHook(() => useComposeDocument("demo-post"), {
      wrapper,
    });

    expect(result.current.content).toBe(defaultDocument.content);
    await waitFor(() =>
      expect(result.current.content).toBe(serverDocument.content),
    );
  });

  it("does not replace local edits when the query resolves later", async () => {
    let resolveDocument!: (document: DocumentEnvelope) => void;
    mocks.getDocument.mockReturnValueOnce(
      new Promise<DocumentEnvelope>((resolve) => {
        resolveDocument = resolve;
      }),
    );
    const { result } = renderHook(() => useComposeDocument("demo-post"), {
      wrapper,
    });
    const localContent: RichTextNode = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "本地编辑" }] },
      ],
    };

    act(() => result.current.replaceContent(localContent));
    await act(async () => resolveDocument(serverDocument));
    await waitFor(() => expect(mocks.getDocument).toHaveBeenCalled());

    expect(result.current.content).toBe(localContent);
  });
});
