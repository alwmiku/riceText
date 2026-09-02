import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { appendChapter } from "@ricetext/document-core";
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
  createDocumentChapter: vi.fn(),
  deleteDocumentChapter: vi.fn(),
  getDocument: vi.fn(),
  listForumChapters: vi.fn(),
  restoreRevision: vi.fn(),
  saveDocument: vi.fn(),
  autosave: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  createDocumentChapter: mocks.createDocumentChapter,
  deleteDocumentChapter: mocks.deleteDocumentChapter,
  getDocument: mocks.getDocument,
  missingDocument: (id: string) => ({
    id,
    title: "未命名文章",
    schemaVersion: 1,
    revision: 0,
    savedAt: new Date(0).toISOString(),
    content: { type: "doc", content: [] },
    storage: "missing",
  }),
  listForumChapters: mocks.listForumChapters,
  restoreRevision: mocks.restoreRevision,
  saveDocument: mocks.saveDocument,
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
        attrs: { level: 2, chapterStart: true },
        content: [{ type: "text", text: "第一章 潮汐表" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "服务器正文" }] },
      {
        type: "heading",
        attrs: { level: 2, chapterStart: true },
        content: [{ type: "text", text: "第二章 陌生船票" }],
      },
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
    mocks.deleteDocumentChapter.mockReset().mockResolvedValue({
      id: "chapter-0",
      deleted: true,
    });
    mocks.createDocumentChapter.mockReset().mockResolvedValue({
      id: "chapter-2",
      title: "第三章 新章节",
      order: 2,
      documentId: "demo-post",
      revision: 0,
      savedAt: "2026-09-01T20:00:00.000Z",
      hidden: false,
    });
    mocks.listForumChapters.mockReset().mockResolvedValue([]);
    mocks.restoreRevision.mockReset();
    mocks.saveDocument.mockReset().mockResolvedValue({
      id: "demo-post",
      title: "未命名文章",
      schemaVersion: 1,
      revision: 1,
      savedAt: "2026-09-03T00:00:00.000Z",
      content: { type: "doc", content: [{ type: "paragraph" }] },
      storage: "server",
    });
    mocks.autosave.mockReset().mockImplementation(
      (options: { onSaved?: (next: DocumentEnvelope) => void }) => ({
        state: "saved",
        revision: defaultDocument.revision,
        savedAt: defaultDocument.savedAt,
        conflictMessage: "",
        flush: vi.fn().mockResolvedValue(true),
        acceptSaved: (next: DocumentEnvelope) => options.onSaved?.(next),
        acceptLatest: vi.fn(),
      }),
    );
  });

  it("404 后保持空白，点击创建只写本地，首次保存才上传服务器", async () => {
    mocks.getDocument.mockResolvedValue({
      id: "demo-post",
      title: "未命名文章",
      schemaVersion: 1,
      revision: 0,
      savedAt: new Date(0).toISOString(),
      content: { type: "doc", content: [] },
      storage: "missing",
    });
    const { result } = renderHook(() => useComposeDocument("demo-post", 0), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
    expect(result.current.articleStarted).toBe(false);
    expect(result.current.content).toEqual({ type: "doc", content: [] });

    act(() => result.current.createLocalArticle());
    expect(result.current.articleStarted).toBe(true);
    expect(result.current.content).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(mocks.saveDocument).not.toHaveBeenCalled();

    await act(() => result.current.publishChapter(0));
    expect(mocks.saveDocument).toHaveBeenCalledWith("demo-post", {
      title: "未命名文章",
      schemaVersion: 1,
      baseRevision: 0,
      clientMutationId: expect.stringMatching(/^create_/),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    await waitFor(() => expect(result.current.document.storage).toBe("server"));
  });

  it("hydrates server content even when placeholder metadata has a higher revision", async () => {
    const { result } = renderHook(() => useComposeDocument("demo-post"), {
      wrapper,
    });

    expect(result.current.content).toEqual({ type: "doc", content: [] });
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
        hidden: false,
      },
      {
        id: "chapter-2",
        title: "第二章",
        order: 2,
        documentId: "demo-post",
        revision: 7,
        savedAt: "2026-08-20T09:00:00.000Z",
        hidden: false,
      },
    ]);
    const testWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useComposeDocument("demo-post", 1), {
      wrapper: testWrapper,
    });
    // 章节 id 需从水合后的正文派生；先等水合完成再取最后一次 autosave 快照。
    await waitFor(() => expect(result.current.content).toBe(serverDocument.content));
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

  it("保存前注册新增章节并把服务器 id 同步回本地目录，再用它保存", async () => {
    const appended = appendChapter(serverDocument.content, "第三章 新章节");
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const testWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    mocks.getDocument.mockResolvedValueOnce({
      ...serverDocument,
      content: appended.document as RichTextNode,
    });
    // 服务器目录已有前两章，仅第三章（order 2）缺失。
    mocks.listForumChapters.mockResolvedValue([
      {
        id: "chapter-0",
        title: "楔子",
        order: 0,
        documentId: "demo-post",
        revision: 1,
        savedAt: "2026-08-20T07:00:00.000Z",
        hidden: false,
      },
      {
        id: "chapter-1",
        title: "第一章 潮汐表",
        order: 1,
        documentId: "demo-post",
        revision: 1,
        savedAt: "2026-08-20T08:00:00.000Z",
        hidden: false,
      },
    ]);

    const { result } = renderHook(() => useComposeDocument("demo-post", 2), {
      wrapper: testWrapper,
    });
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));

    await act(async () => {
      await result.current.publishChapter(2);
    });

    // 1. 只有缺失的第三章调用新增章节接口。
    expect(mocks.createDocumentChapter).toHaveBeenCalledTimes(1);
    expect(mocks.createDocumentChapter).toHaveBeenCalledWith("demo-post", {
      title: "第三章 新章节",
      order: 2,
    });
    // 2. 服务器 id 已同步回本地目录缓存。
    const chapters = client.getQueryData<ForumChapterItem[]>([
      "forum",
      "chapters",
    ])!;
    expect(chapters).toContainEqual(
      expect.objectContaining({ id: "chapter-2", order: 2, revision: 0 }),
    );
    // 3. 文档保存使用服务器分配的章节 id。
    const autosaveValue = mocks.autosave.mock.results.at(-1)?.value as {
      flush: (
        content: RichTextNode,
        generation: number,
        chapterId?: string,
      ) => Promise<boolean>;
    };
    expect(autosaveValue.flush).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "chapter-2",
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
