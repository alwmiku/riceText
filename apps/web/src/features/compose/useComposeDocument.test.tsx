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
import type {
  DocumentEnvelope,
  ForumChapterItem,
  RichTextNode,
} from "../../lib/types";
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
vi.mock("../editor/hooks/useAutosave", () => ({ useAutosave: mocks.autosave }));

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

  it("服务器保存后立即同步当前章节版本和保存时间缓存", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData<ForumChapterItem[]>(["forum", "chapters"], [
      {
        id: "chapter-1",
        title: "第一章 潮汐表",
        order: 1,
        documentId: "demo-post",
        revision: 4,
        savedAt: "2026-08-20T08:00:00.000Z",
      },
      {
        id: "chapter-2",
        title: "第二章",
        order: 2,
        documentId: "demo-post",
        revision: 7,
        savedAt: "2026-08-20T09:00:00.000Z",
      },
    ]);
    const testWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useComposeDocument("demo-post", "chapter-1"), {
      wrapper: testWrapper,
    });
    await waitFor(() => expect(mocks.autosave).toHaveBeenCalled());
    const options = mocks.autosave.mock.calls.at(-1)?.[0] as {
      onSaved: (next: DocumentEnvelope) => void;
    };
    const savedAt = "2026-09-01T18:56:00.000Z";
    act(() =>
      options.onSaved({
        ...serverDocument,
        revision: 12,
        savedAt,
        storage: "server",
      }),
    );
    const chapters = client.getQueryData<ForumChapterItem[]>([
      "forum",
      "chapters",
    ])!;
    expect(chapters.find((chapter) => chapter.id === "chapter-1")).toMatchObject({
      revision: 5,
      savedAt,
    });
    expect(chapters.find((chapter) => chapter.id === "chapter-2")).toMatchObject({
      revision: 7,
      savedAt: "2026-08-20T09:00:00.000Z",
    });
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
