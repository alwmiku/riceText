import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
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

function HydrationRaceHarness() {
  const compose = useComposeDocument("demo-post");
  const chapterHeading = compose.content.content?.find(
    (node) => node.type === "heading" && node.attrs?.level === 2,
  );

  useEffect(() => {
    if (compose.isPlaceholderData || chapterHeading) return;
    // 模拟编辑器在权限开启时立即上报占位正文的规范化结果。
    compose.replaceContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "错误的占位规范化正文" }],
        },
      ],
    });
  }, [chapterHeading, compose.isPlaceholderData, compose.replaceContent]);

  return (
    <span>
      {chapterHeading?.content?.[0]?.text ??
        (compose.isPlaceholderData ? "加载中" : "无章节")}
    </span>
  );
}

describe("useComposeDocument hydration", () => {
  beforeEach(() => {
    localStorage.clear();
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

  it("水合落地前保持加载态并忽略编辑器的占位规范化上报", async () => {
    render(<HydrationRaceHarness />, { wrapper });

    expect(await screen.findByText("第一章 潮汐表")).toBeInTheDocument();
    expect(screen.queryByText("错误的占位规范化正文")).not.toBeInTheDocument();
  });

  it("恢复与服务器 revision 一致的本地自动保存草稿", async () => {
    const localContent: RichTextNode = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "第一章 潮汐表" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "本地草稿" }] },
      ],
    };
    localStorage.setItem(
      "ricetext:draft:demo-post",
      JSON.stringify({
        documentId: "demo-post",
        baseRevision: 1,
        content: localContent,
        savedAt: "2026-08-20T10:00:00.000Z",
      }),
    );
    const { result } = renderHook(() => useComposeDocument("demo-post"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.content).toEqual(localContent));
    expect(result.current.document.revision).toBe(1);
    expect(result.current.generation).toBe(1);
  });

  it("丢弃基于旧 revision 的本地草稿", async () => {
    localStorage.setItem(
      "ricetext:draft:demo-post",
      JSON.stringify({
        documentId: "demo-post",
        baseRevision: 0,
        content: { type: "doc", content: [] },
        savedAt: "2026-08-20T10:00:00.000Z",
      }),
    );
    const { result } = renderHook(() => useComposeDocument("demo-post"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.content).toBe(serverDocument.content));
    expect(localStorage.getItem("ricetext:draft:demo-post")).toBeNull();
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
