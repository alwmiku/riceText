import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import type { RichTextNode } from "../../lib/types";
import { useChapterUpload } from "./useChapterUpload";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  sync: vi.fn(),
  batchUpload: vi.fn(),
  stage: vi.fn(),
  hash: vi.fn(),
  gaps: vi.fn(),
  loadCheckpoint: vi.fn(),
  saveCheckpoint: vi.fn(),
  deleteCheckpoint: vi.fn(),
  deleteChapter: vi.fn(),
  createSession: vi.fn(),
  completeSession: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly details?: unknown,
      readonly code = "UNKNOWN_ERROR",
    ) {
      super(message);
    }
  },
  listForumChapters: mocks.list,
  syncLongTextChapters: mocks.sync,
  stageLongTextChapterUploadBatch: (
    novelId: string,
    _uploadId: string,
    chapters: unknown,
  ) => mocks.batchUpload(novelId, chapters),
  createLongTextChapterUpload: mocks.createSession,
  completeLongTextChapterUpload: mocks.completeSession,
  stageLongTextChapterReorder: mocks.stage,
  deleteDocumentChapter: mocks.deleteChapter,
}));
vi.mock("../../lib/utils", () => ({ sha256Hex: mocks.hash }));
vi.mock("../../lib/long-text-draft-storage", () => ({
  loadLongTextValue: mocks.loadCheckpoint,
  saveLongTextValue: mocks.saveCheckpoint,
  deleteLongTextValue: mocks.deleteCheckpoint,
}));
vi.mock("../novel/raw-coverage", () => ({ collectRawGaps: mocks.gaps }));

function chapter(id: string, title: string, text: string): RichTextNode {
  return {
    type: "longTextBlock",
    attrs: { chapterId: id, title, text },
  };
}

function documentFixture(): RichTextNode {
  return {
    type: "doc",
    content: [
      chapter("new", "新章", "new text"),
      chapter("changed", "改章", "changed text"),
      chapter("same", "旧章", "same text"),
    ],
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useChapterUpload", () => {
  beforeEach(() => {
    mocks.list.mockReset().mockResolvedValue([
      { id: "changed", order: 1, revision: 4 },
      { id: "same", order: 2, revision: 2 },
    ]);
    mocks.sync.mockReset().mockResolvedValue({
      toUpdate: ["new", "changed"],
      existing: ["changed", "same"],
    });
    mocks.batchUpload
      .mockReset()
      .mockImplementation(async (_novelId: string, body: Array<{ id: string; title: string; order: number; baseRevision: number }>) => ({
        chapters: body.map((input) => ({
          id: input.id,
          title: input.title,
          order: input.order,
          revision: input.baseRevision + 1,
          status: "saved" as const,
        })),
      }));
    mocks.stage
      .mockReset()
      .mockImplementation(async (_novelId: string, body: Array<{ id: string; temporaryOrder: number; baseRevision: number }>) => ({
        chapters: body.map((input) => ({
          id: input.id,
          revision: input.baseRevision + 1,
          status: "staged" as const,
        })),
      }));
    mocks.hash.mockReset().mockImplementation(async (value: string) => value);
    mocks.gaps.mockReset().mockReturnValue([{ start: 0, end: 2, chars: 2 }]);
    mocks.loadCheckpoint.mockReset().mockResolvedValue(undefined);
    mocks.saveCheckpoint.mockReset().mockResolvedValue(undefined);
    mocks.deleteCheckpoint.mockReset().mockResolvedValue(undefined);
    mocks.deleteChapter.mockReset().mockResolvedValue({
      id: "chapter-0",
      deleted: true,
    });
    mocks.createSession.mockReset().mockResolvedValue({
      uploadId: "upload-test",
      manifestHash: "a".repeat(64),
      totalChapters: 3,
      status: "uploading",
      staged: [],
    });
    mocks.completeSession.mockReset().mockResolvedValue({
      uploadId: "upload-test",
      manifestHash: "a".repeat(64),
      totalChapters: 3,
      publishedAt: "2026-09-04T00:00:00.000Z",
    });
  });

  it("请求章节差异前创建缺失的服务器文档", async () => {
    const ensureDocument = vi.fn().mockResolvedValue("created" as const);
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "article-local",
          captureSnapshot: () => ({ document: (documentFixture)(), coverage: [] }),
          ensureDocument,
          onNotice: vi.fn(),
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());

    expect(ensureDocument).toHaveBeenCalledOnce();
    expect(ensureDocument.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.list.mock.invocationCallOrder[0]!,
    );
  });

  it("创建长文档时移除自动生成的空章节", async () => {
    const ensureDocument = vi.fn().mockResolvedValue("created" as const);
    mocks.list.mockResolvedValue([
      { id: "chapter-0", title: "正文", order: 0, revision: 1 },
    ]);
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "article-local",
          captureSnapshot: () => ({ document: (documentFixture)(), coverage: [] }),
          ensureDocument,
          onNotice: vi.fn(),
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());

    expect(mocks.deleteChapter).toHaveBeenCalledWith(
      "article-local",
      "chapter-0",
    );
    expect(result.current.diff).toMatchObject({ remoteOnly: 0 });
  });

  it("关闭弹窗并在当前原子批次完成后暂停", async () => {
    let finishUpload!: (value: { chapters: Array<{ id: string; title: string; order: number; revision: number; status: string }> }) => void;
    mocks.list.mockResolvedValue([]);
    mocks.sync.mockResolvedValue({ toUpdate: ["new"], existing: [] });
    mocks.batchUpload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishUpload = resolve;
        }),
    );
    const oneChapter = () => ({
      type: "doc",
      content: [chapter("new", "新章", "正文")],
    });
    const notice = vi.fn();
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          captureSnapshot: () => ({ document: (oneChapter)(), coverage: [] }),
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    let confirmation!: Promise<void>;
    act(() => {
      confirmation = result.current.confirm();
    });
    await waitFor(() => expect(result.current.uploading).toBe(true));
    act(() => result.current.cancel());
    expect(result.current.open).toBe(false);
    expect(notice).toHaveBeenLastCalledWith("将在当前批次完成后暂停");
    // 确认已把批次请求发出（延迟 promise 已挂起）后再放行。
    await waitFor(() =>
      expect(mocks.batchUpload).toHaveBeenCalledTimes(1),
    );
    await act(async () => {
      finishUpload({
        chapters: [
          { id: "new", title: "新章", order: 0, revision: 1, status: "saved" },
        ],
      });
      await confirmation;
    });
    expect(mocks.batchUpload).toHaveBeenCalledTimes(1);
    expect(result.current.hasCheckpoint).toBe(true);
    expect(notice).toHaveBeenLastCalledWith("上传已暂停，可稍后继续");
    expect(mocks.completeSession).not.toHaveBeenCalled();
    mocks.createSession.mockResolvedValueOnce({ uploadId: "upload-test", staged: ["new"] });
    act(() => result.current.resume());
    expect(result.current.open).toBe(true);
    await act(async () => result.current.confirm());
    expect(mocks.batchUpload).toHaveBeenCalledTimes(1);
    expect(mocks.completeSession).toHaveBeenCalledOnce();
    expect(result.current.hasCheckpoint).toBe(false);
  });

  it("映射同步结果，并以不含 longTextBlock 的单个批次上传变化章节", async () => {
    const document = documentFixture();
    const notice = vi.fn();
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          captureSnapshot: () => ({ document: (() => document)(), coverage: [] }),
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    expect(result.current.diff).toMatchObject({
      total: 3,
      toUpdate: 3,
      added: 1,
      modified: 1,
      gaps: 1,
    });
    expect(result.current.diff?.rows.map((row) => row.action)).toEqual([
      "add",
      "modify",
      "unchanged",
    ]);
    expect(result.current.diff?.rows.map((row) => row.status)).toEqual([
      "pending",
      "pending",
      "unchanged",
    ]);

    await act(async () => result.current.confirm());

    expect(mocks.batchUpload).toHaveBeenCalledTimes(1);
    const [novelId, payload] = mocks.batchUpload.mock.calls[0] as [
      string,
      Array<Record<string, unknown>>,
    ];
    expect(novelId).toBe("demo-post");
    expect(payload.map((item) => item.id)).toEqual(["new", "changed", "same"]);
    expect(payload[0]).toMatchObject({
      title: "新章",
      order: 0,
      baseRevision: 0,
    });
    expect(payload[1]).toMatchObject({
      title: "改章",
      order: 1,
      baseRevision: 4,
    });
    expect(JSON.stringify(payload[0]?.content)).not.toContain(
      "longTextBlock",
    );
    expect(payload[0]?.content).toMatchObject({
      type: "doc",
      content: [
        { type: "heading", attrs: { chapterStart: true, level: 2 } },
        { type: "paragraph", content: [{ type: "text", text: "new text" }] },
      ],
    });
    expect(notice).toHaveBeenCalledWith("已分章上传 3 章；仍有 1 段原文未切分");
    expect(mocks.saveCheckpoint).toHaveBeenCalled();
    const lastSaved = mocks.saveCheckpoint.mock.calls.at(-1)?.[1] as {
      version: number;
      chapters: Array<Record<string, unknown>>;
    };
    expect(lastSaved.version).toBe(6);
    expect(
      lastSaved.chapters.every((entry) => !("content" in entry)),
    ).toBe(true);
  });

  it("将 3000 章拆为 150 批，每批最多 20 章", async () => {
    const manyChapters: RichTextNode = {
      type: "doc",
      content: Array.from({ length: 3000 }, (_, index) =>
        chapter("ch-" + index, "章节 " + index, "正文 " + index),
      ),
    };
    mocks.list.mockResolvedValue([]);
    mocks.sync.mockResolvedValue({
      toUpdate: manyChapters.content!.map((node) => String(node.attrs?.chapterId)),
      existing: [],
    });
    const notice = vi.fn();
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          captureSnapshot: () => ({ document: (() => manyChapters)(), coverage: [] }),
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    await act(async () => result.current.confirm());

    const calls = mocks.batchUpload.mock.calls;
    expect(calls).toHaveLength(150);
    expect(calls.every((call) => (call[1] as unknown[]).length <= 20)).toBe(true);
    const total = calls.reduce(
      (sum, call) =>
        sum + (call[1] as unknown[]).length,
      0,
    );
    expect(total).toBe(3000);
    const orders = calls.flatMap((call) =>
      (call[1] as Array<{ order: number }>).map((chapter) => chapter.order),
    );
    expect(orders).toEqual(Array.from({ length: 3000 }, (_, index) => index));
    expect(notice).toHaveBeenCalledWith(
      "已分章上传 3000 章；仍有 1 段原文未切分",
    );
  }, 60_000);

  it("将返回 413 的批次不断二分，直到单章", async () => {
    const four = () => ({
      type: "doc",
      content: [
        chapter("a", "A", "a"),
        chapter("b", "B", "b"),
        chapter("c", "C", "c"),
        chapter("d", "D", "d"),
      ],
    });
    mocks.list.mockResolvedValue([]);
    mocks.sync.mockResolvedValue({
      toUpdate: ["a", "b", "c", "d"],
      existing: [],
    });
    mocks.batchUpload.mockImplementation(async () => {
      const error = new ApiError("批量请求体超过上限", 413, undefined, "CHAPTER_BATCH_TOO_LARGE");
      throw error;
    });
    // 第一次整批 413 后，二分命中 2 个一组的子批；这里分批放行。
    mocks.batchUpload
      .mockReset()
      .mockImplementationOnce(async () => {
        throw new ApiError("批量请求体超过上限", 413, undefined, "CHAPTER_BATCH_TOO_LARGE");
      })
      .mockImplementation(async (_novelId: string, body: Array<{ id: string; title: string; order: number; baseRevision: number }>) => ({
        chapters: body.map((input) => ({
          id: input.id,
          title: input.title,
          order: input.order,
          revision: input.baseRevision + 1,
          status: "saved" as const,
        })),
      }));
    const notice = vi.fn();
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          captureSnapshot: () => ({ document: (four)(), coverage: [] }),
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    await act(async () => result.current.confirm());

    const sizes = mocks.batchUpload.mock.calls.map(
      (call) => (call[1] as unknown[]).length,
    );
    expect(sizes[0]).toBe(4);
    expect(sizes.slice(1).sort()).toEqual([2, 2]);
    expect(result.current.diff).toMatchObject({ uploaded: 4, batchCurrent: 2, batchTotal: 2 });
    expect(result.current.hasCheckpoint).toBe(false);
  });

  it("在重试次数上限内对 429 退避重试并成功", async () => {
    const one = () => ({
      type: "doc",
      content: [chapter("new", "新章", "正文")],
    });
    mocks.list.mockResolvedValue([]);
    mocks.sync.mockResolvedValue({ toUpdate: ["new"], existing: [] });
    mocks.batchUpload
      .mockReset()
      .mockRejectedValueOnce(new ApiError("速率受限", 429))
      .mockRejectedValueOnce(new ApiError("速率受限", 429))
      .mockImplementation(async (_novelId: string, body: Array<{ id: string; title: string; order: number; baseRevision: number }>) => ({
        chapters: body.map((input) => ({
          id: input.id,
          title: input.title,
          order: input.order,
          revision: input.baseRevision + 1,
          status: "saved" as const,
        })),
      }));
    const notice = vi.fn();
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          captureSnapshot: () => ({ document: (one)(), coverage: [] }),
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    await act(async () => result.current.confirm());

    expect(mocks.batchUpload).toHaveBeenCalledTimes(3);
    expect(result.current.diff?.rows[0]).toMatchObject({ status: "uploaded" });
    expect(notice).toHaveBeenCalledWith("已分章上传 1 章；仍有 1 段原文未切分");
  });

  it("不重试 409 冲突并保留检查点", async () => {
    const oneChapter = () => ({
      type: "doc",
      content: [chapter("changed", "改章", "changed text")],
    });
    mocks.sync.mockResolvedValue({
      toUpdate: ["changed"],
      existing: ["changed"],
    });
    mocks.batchUpload.mockRejectedValue(
      new ApiError(
        "章节已被其他修改更新",
        409,
        { currentRevision: 5 },
        "CHAPTER_REVISION_CONFLICT",
      ),
    );
    const notice = vi.fn();
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          captureSnapshot: () => ({ document: (oneChapter)(), coverage: [] }),
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    await act(async () => result.current.confirm());
    expect(result.current.diff?.rows[0]).toMatchObject({
      status: "failed",
      retryable: false,
    });
    expect(mocks.batchUpload).toHaveBeenCalledTimes(1);
    expect(result.current.hasCheckpoint).toBe(true);
    expect(mocks.completeSession).not.toHaveBeenCalled();
  });

  it("原子发布前暂存未变化的清单", async () => {
    mocks.sync.mockResolvedValue({
      toUpdate: [],
      existing: ["new", "changed", "same"],
    });
    const notice = vi.fn();
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          captureSnapshot: () => ({ document: (documentFixture)(), coverage: [] }),
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    expect(result.current.diff?.toUpdate).toBe(3);
    await act(async () => result.current.confirm());

    expect(mocks.batchUpload).toHaveBeenCalledOnce();
    expect(mocks.completeSession).toHaveBeenCalledOnce();
    expect(notice).toHaveBeenCalledWith("已分章上传 3 章；仍有 1 段原文未切分");
  });

  it("切换文档后忽略尚未完成的准备结果", async () => {
    let resolveDirectory!: (value: unknown[]) => void;
    mocks.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDirectory = resolve;
        }),
    );
    const notice = vi.fn();
    const { result, rerender } = renderHook(
      ({ novelId }) =>
        useChapterUpload({
          novelId,
          captureSnapshot: () => ({ document: (documentFixture)(), coverage: [] }),
          onNotice: notice,
        }),
      { wrapper, initialProps: { novelId: "article-a" } },
    );

    let preparation!: Promise<void>;
    act(() => {
      preparation = result.current.prepare();
    });
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    rerender({ novelId: "article-b" });
    await act(async () => {
      resolveDirectory([]);
      await preparation;
    });

    expect(result.current.diff).toBeNull();
    expect(result.current.open).toBe(false);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("确认时以当前正文为准：准备后即使正文有变化也直接上传最新内容", async () => {
    let document = documentFixture();
    const notice = vi.fn();
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          captureSnapshot: () => ({ document: (() => document)(), coverage: [] }),
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    document = {
      type: "doc",
      content: [chapter("new", "准备后改名", "later text")],
    };
    await act(async () => result.current.confirm());

    // 不做任何快照校验：按当前正文重建计划后直接上传最新内容。
    expect(mocks.batchUpload).toHaveBeenCalledTimes(1);
    const payload = mocks.batchUpload.mock.calls[0]?.[1] as Array<
      Record<string, unknown>
    >;
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({ title: "准备后改名", order: 0 });
    expect(result.current.hasCheckpoint).toBe(false);
    expect(result.current.diff?.rows[0]).toMatchObject({ status: "uploaded" });
  });


  it("暂存重排章节而不移动线上目录", async () => {
    const reordered = () => ({
      type: "doc",
      content: [
        chapter("changed", "改章", "changed text"),
        chapter("same", "旧章", "same text"),
      ],
    });
    mocks.sync.mockResolvedValue({
      toUpdate: ["changed", "same"],
      existing: ["changed", "same"],
    });
    const notice = vi.fn();
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          captureSnapshot: () => ({ document: (reordered)(), coverage: [] }),
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    await act(async () => result.current.confirm());

    expect(mocks.stage).not.toHaveBeenCalled();
    const batchPayload = mocks.batchUpload.mock.calls[0]?.[1] as Array<
      Record<string, unknown>
    >;
    expect(
      batchPayload.map((item) => [item.id, item.order, item.baseRevision]),
    ).toEqual([
      ["changed", 0, 4],
      ["same", 1, 2],
    ]);
    expect(mocks.completeSession).toHaveBeenCalledOnce();
    expect(result.current.diff?.uploaded).toBe(2);
  });

  it("持久化进度并恢复上传，不重复上传已是最新的章节", async () => {
    mocks.createSession
      .mockResolvedValueOnce({ uploadId: "upload-test", manifestHash: "a".repeat(64), totalChapters: 3, status: "uploading", staged: [] })
      .mockResolvedValueOnce({ uploadId: "upload-test", manifestHash: "a".repeat(64), totalChapters: 3, status: "uploading", staged: ["new", "same"] });
    mocks.sync
      .mockResolvedValueOnce({
        toUpdate: ["new", "changed"],
        existing: ["changed", "same"],
      })
      .mockResolvedValueOnce({
        toUpdate: ["new", "changed"],
        existing: ["changed", "same"],
      })
      .mockResolvedValueOnce({
        toUpdate: ["changed"],
        existing: ["new", "changed", "same"],
      });
    // 首次确认：1 次初始 + 3 次指数退避全部失败，模拟批次中断。
    mocks.batchUpload
      .mockReset()
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockImplementation(async (_novelId: string, body: Array<{ id: string; title: string; order: number; baseRevision: number }>) => ({
        chapters: body.map((input) => ({
          id: input.id,
          title: input.title,
          order: input.order,
          revision: input.baseRevision + 1,
          status: "saved" as const,
        })),
      }));
    const notice = vi.fn();
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          captureSnapshot: () => ({ document: (documentFixture)(), coverage: [] }),
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    await act(async () => result.current.confirm());
    expect(result.current.diff?.rows.map((row) => row.status)).toEqual([
      "failed",
      "failed",
      "failed",
    ]);
    expect(result.current.hasCheckpoint).toBe(true);

    await act(async () => result.current.confirm());
    const ids = mocks.batchUpload.mock.calls.map(
      (call) => ((call[1] as Array<{ id: string }>).map((item) => item.id)).join(","),
    );
    // 首次重试了 4 次（1 次 + 3 次退避），恢复时 new 已是最新，只重发 changed。
    expect(ids[ids.length - 1]).toBe("changed");
    expect(result.current.diff?.rows.map((row) => row.status)).toEqual([
      "uploaded",
      "uploaded",
      "uploaded",
    ]);
    expect(result.current.diff?.uploaded).toBe(3);
    expect(result.current.hasCheckpoint).toBe(false);
    expect(mocks.deleteCheckpoint).toHaveBeenCalledWith(
      "ricetext:long-text-upload:demo-post",
    );
  });

  it("丢弃引入 SHA-256 章节标识之前创建的检查点", async () => {
    const document = documentFixture();
    // 先正常 prepare 一次拿到 v6 计划，再改造成旧版并从 IndexedDB 恢复。
    const first = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          captureSnapshot: () => ({ document: (() => document)(), coverage: [] }),
          onNotice: vi.fn(),
        }),
      { wrapper },
    );
    await act(async () => first.result.current.prepare());
    const saved = mocks.saveCheckpoint.mock.calls.at(-1)?.[1] as {
      version: number;
      novelId: string;
      sourceHash: string;
      chapters: Array<Record<string, unknown>>;
    };
    expect(saved.version).toBe(6);
    first.unmount();

    const v1Checkpoint = {
      ...saved,
      version: 1,
      chapters: saved.chapters.map((entry, index) => ({
        ...entry,
        content: {
          type: "doc",
          content: [
            { type: "longTextBlock", attrs: { title: entry.title, text: "正文 " + index } },
          ],
        },
      })),
    };
    mocks.deleteCheckpoint.mockClear();
    mocks.loadCheckpoint.mockResolvedValue(v1Checkpoint);
    mocks.list.mockResolvedValue([]);
    mocks.sync.mockResolvedValue({
      toUpdate: ["new", "changed"],
      existing: [],
    });
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          captureSnapshot: () => ({ document: (() => document)(), coverage: [] }),
          onNotice: vi.fn(),
        }),
      { wrapper },
    );

    await waitFor(() =>
      expect(mocks.deleteCheckpoint).toHaveBeenCalledWith(
        "ricetext:long-text-upload:demo-post",
      ),
    );
    expect(result.current.hasCheckpoint).toBe(false);
  });

  it("准备时标记超过 1.8 MiB 的章节并跳过上传", async () => {
    const huge: RichTextNode = {
      type: "doc",
      content: [
        chapter("huge", "巨型章", "a".repeat(1_900_000)),
        chapter("small", "小章", "ok text"),
      ],
    };
    mocks.list.mockResolvedValue([]);
    mocks.sync.mockResolvedValue({
      toUpdate: ["huge", "small"],
      existing: [],
    });
    const notice = vi.fn();
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          captureSnapshot: () => ({ document: (() => huge)(), coverage: [] }),
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    expect(result.current.diff?.rows[0]).toMatchObject({
      status: "failed",
      retryable: false,
    });
    expect(result.current.diff?.rows[0]?.error).toContain("巨型章");
    await act(async () => result.current.confirm());
    // 原子发布要求完整清单，任一超限时不暂存任何章节。
    expect(mocks.batchUpload).not.toHaveBeenCalled();
    expect(notice).toHaveBeenLastCalledWith(
      "上传计划存在结构或大小冲突，请重新检查差异",
    );
  });
  it("容忍编辑器回写的良性属性漂移：逐章一致时继续上传", async () => {
    let document = documentFixture();
    const notice = vi.fn();
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          captureSnapshot: () => ({ document: (() => document)(), coverage: [] }),
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    // 模拟编辑器把当前章节节点按 schema 重排属性（键顺序变化、补齐默认值），
    // 但 title/text 与顺序完全不变：整篇 JSON 不同，逐章转换结果一致。
    document = {
      ...document,
      content: document.content!.map((node, index) => ({
        type: "longTextBlock" as const,
        attrs: {
          order: index,
          chapterId: String(node.attrs?.chapterId),
          text: String(node.attrs?.text),
          title: String(node.attrs?.title),
          start: null,
          end: null,
        },
      })),
    };
    await act(async () => result.current.confirm());

    expect(notice).not.toHaveBeenCalledWith(
      expect.stringContaining("请重新检查差异"),
    );
    expect(mocks.batchUpload).toHaveBeenCalledTimes(1);
    expect(result.current.diff?.rows.map((row) => row.status)).toEqual([
      "uploaded",
      "uploaded",
      "uploaded",
    ]);
  });

  it("目标顺序被旧行占用时只写会话暂存区", async () => {
    const one = () => ({
      type: "doc",
      content: [chapter("new", "新章", "正文")],
    });
    // 服务器目录只有一篇「正文」占位行（位于 order 0），本地新章 id 不同。
    mocks.list.mockResolvedValue([
      { id: "article-0-chapter-0-abc", order: 0, revision: 1 },
    ]);
    mocks.sync.mockResolvedValue({
      toUpdate: ["new"],
      existing: ["article-0-chapter-0-abc"],
    });
    const notice = vi.fn();
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          captureSnapshot: () => ({ document: (one)(), coverage: [] }),
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    await act(async () => result.current.confirm());

    expect(mocks.stage).not.toHaveBeenCalled();
    const batchPayload = mocks.batchUpload.mock.calls[0]?.[1] as Array<
      Record<string, unknown>
    >;
    expect(batchPayload).toHaveLength(1);
    expect(batchPayload[0]).toMatchObject({ id: "new", order: 0 });
    expect(mocks.completeSession).toHaveBeenCalledOnce();
    expect(result.current.diff?.rows[0]).toMatchObject({ status: "uploaded" });
  });


  it("服务器额外行不参与暂存清单并在原子发布时替换", async () => {
    const three = () => ({
      type: "doc",
      content: [
        chapter("a", "第一章", "aaa"),
        chapter("b", "第二章", "bbb"),
        chapter("c", "第三章", "ccc"),
      ],
    });
    // 服务器目录：一个「正文」占位行位于 order 1（本地第二顺位）。
    mocks.list.mockResolvedValue([
      { id: "article-0-chapter-1-placeholder", order: 1, revision: 1 },
    ]);
    mocks.sync.mockResolvedValue({
      toUpdate: ["a", "b", "c"],
      existing: ["article-0-chapter-1-placeholder"],
    });
    const notice = vi.fn();
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          captureSnapshot: () => ({ document: (three)(), coverage: [] }),
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    await act(async () => result.current.confirm());

    expect(mocks.stage).not.toHaveBeenCalled();
    const batchIds = mocks.batchUpload.mock.calls.flatMap(
      (call) =>
        (call[1] as Array<Record<string, unknown>>).map((item) => item.id),
    );
    expect(batchIds).toEqual(["a", "b", "c"]);
    expect(result.current.diff).toMatchObject({ remoteOnly: 1, toUpdate: 3 });
    expect(result.current.diff?.rows.map((row) => row.status)).toEqual([
      "uploaded",
      "uploaded",
      "uploaded",
      "awaiting_replacement",
    ]);
    expect(mocks.completeSession).toHaveBeenCalledOnce();
  });



  it("迁移正常的 v5 检查点，并在恢复前核对已暂存章节", async () => {
    const legacy = {
      version: 5, novelId: "demo-post", gaps: 0,
      chapters: ["new", "changed", "same"].map((id, order) => ({
        id, title: id, volumeTitle: "卷一", order, hash: "a".repeat(64),
        baseRevision: 0, action: order === 1 ? "修改" : "新增",
        status: order === 1 ? "上传中" : "已上传", attempts: 1,
      })),
    };
    mocks.loadCheckpoint.mockResolvedValue(legacy);
    mocks.createSession.mockResolvedValue({ uploadId: "resumed", staged: ["new", "same"] });
    const notice = vi.fn();
    const { result } = renderHook(() => useChapterUpload({
      novelId: "demo-post", captureSnapshot: () => ({ document: documentFixture(), coverage: [] }), onNotice: notice,
    }), { wrapper });
    await waitFor(() => expect(result.current.hasCheckpoint).toBe(true));
    expect(result.current.diff?.rows.map((row) => row.status)).toEqual(["uploaded", "pending", "uploaded"]);
    expect(mocks.saveCheckpoint).toHaveBeenCalledWith("ricetext:long-text-upload:demo-post", expect.objectContaining({ version: 6 }));
    act(() => result.current.resume());
    expect(result.current.open).toBe(true);
    await act(async () => result.current.confirm());
    expect(mocks.batchUpload.mock.calls.flatMap((call) => call[1].map((row: { id: string }) => row.id))).toEqual(["changed"]);
    expect(mocks.completeSession).toHaveBeenCalledWith("demo-post", "resumed");
    expect(result.current.hasCheckpoint).toBe(false);
    expect(notice).not.toHaveBeenCalledWith(expect.stringContaining("重新准备"));
  });

  it.each([
    null,
    { version: 6, novelId: "demo-post", gaps: 0, chapters: null },
    { version: 99, novelId: "demo-post", gaps: 0, chapters: [] },
    { version: 6, novelId: "other", gaps: 0, chapters: [] },
  ])("拒绝损坏的检查点，提示重新准备并保留正文草稿：%j", async (stored) => {
    const draft = documentFixture();
    const before = structuredClone(draft);
    const captureSnapshot = vi.fn(() => ({ document: draft, coverage: [] }));
    mocks.loadCheckpoint.mockResolvedValue(stored);
    const notice = vi.fn();
    const { result } = renderHook(() => useChapterUpload({ novelId: "demo-post", captureSnapshot, onNotice: notice }), { wrapper });
    await waitFor(() => expect(notice).toHaveBeenCalledWith(expect.stringContaining("请重新准备上传；正文草稿已保留")));
    expect(mocks.deleteCheckpoint).toHaveBeenCalledExactlyOnceWith("ricetext:long-text-upload:demo-post");
    expect(draft).toEqual(before);
    expect(captureSnapshot).not.toHaveBeenCalled();
    expect(result.current.diff).toBeNull();
    await act(async () => result.current.confirm());
    expect(mocks.createSession).not.toHaveBeenCalled();
    await act(async () => result.current.prepare());
    expect(result.current.open).toBe(true);
  });

  it("重新挂载后保留已全部暂存的暂停检查点，以便完成发布", async () => {
    mocks.loadCheckpoint.mockResolvedValue({
      version: 6, novelId: "demo-post", gaps: 0,
      chapters: ["new", "changed", "same"].map((id, order) => ({
        id, title: id, order, hash: "a".repeat(64), baseRevision: 1,
        action: "add", status: "uploaded", attempts: 1,
      })),
    });
    mocks.createSession.mockResolvedValue({ uploadId: "staged", staged: ["new", "changed", "same"] });
    const { result } = renderHook(() => useChapterUpload({
      novelId: "demo-post", captureSnapshot: () => ({ document: documentFixture(), coverage: [] }), onNotice: vi.fn(),
    }), { wrapper });
    await waitFor(() => expect(result.current.hasCheckpoint).toBe(true));
    expect(mocks.deleteCheckpoint).not.toHaveBeenCalled();
    expect(result.current.diff?.published).toBe(false);
    act(() => result.current.resume());
    await act(async () => result.current.confirm());
    expect(result.current.diff?.published).toBe(true);
    expect(mocks.batchUpload).not.toHaveBeenCalled();
    expect(mocks.completeSession).toHaveBeenCalledWith("demo-post", "staged");
  });

  it("等待准备操作前一次性同时捕获文档与覆盖信息", async () => {
    let resolveDirectory!: (value: unknown[]) => void;
    mocks.list.mockImplementationOnce(() => new Promise((resolve) => { resolveDirectory = resolve; }));
    const draft = documentFixture();
    const coverage = [{ id: "one", title: "第一章", charCount: 2, start: 0, end: 2, preview: "正文" }];
    const captureSnapshot = vi.fn(() => ({ document: draft, coverage }));
    const { result } = renderHook(() => useChapterUpload({ novelId: "demo-post", captureSnapshot, onNotice: vi.fn() }), { wrapper });
    let preparation!: Promise<void>;
    act(() => { preparation = result.current.prepare(); });
    draft.content![0]!.attrs!.title = "后来的标题";
    coverage[0]!.end = 999;
    await act(async () => { resolveDirectory([]); await preparation; });
    expect(captureSnapshot).toHaveBeenCalledOnce();
    expect(result.current.diff?.rows[0]!.title).toBe("新章");
    expect(mocks.gaps).toHaveBeenCalledWith([expect.objectContaining({ end: 2 })]);
  });

  it.each(["create", "batch", "complete"] as const)("切换文章后忽略迟到的 %s 成功结果", async (boundary) => {
    const target = boundary === "create" ? mocks.createSession : boundary === "batch" ? mocks.batchUpload : mocks.completeSession;
    let release!: (value: unknown) => void;
    target.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const notice = vi.fn();
    const { result, rerender } = renderHook(({ novelId }) => useChapterUpload({
      novelId, captureSnapshot: () => ({ document: documentFixture(), coverage: [] }), onNotice: notice,
    }), { wrapper, initialProps: { novelId: "article-a" } });
    await act(async () => result.current.prepare());
    let confirmation!: Promise<void>;
    act(() => { confirmation = result.current.confirm(); });
    await waitFor(() => expect(target).toHaveBeenCalledOnce());
    rerender({ novelId: "article-b" });
    await act(async () => result.current.prepare());
    const currentDiff = result.current.diff;
    const saveCount = mocks.saveCheckpoint.mock.calls.length;
    await act(async () => {
      release(boundary === "create" ? { uploadId: "late", staged: [] } : boundary === "batch" ? { chapters: [] } : {});
      await confirmation;
    });
    expect(result.current.diff).toBe(currentDiff);
    expect(result.current.open).toBe(true);
    expect(result.current.uploading).toBe(false);
    expect(mocks.saveCheckpoint).toHaveBeenCalledTimes(saveCount);
    expect(mocks.deleteCheckpoint).not.toHaveBeenCalled();
    expect(notice).not.toHaveBeenCalled();
    if (boundary === "create") expect(mocks.batchUpload).not.toHaveBeenCalled();
    if (boundary !== "complete") expect(mocks.completeSession).not.toHaveBeenCalled();
  });

  it.each(["create", "batch", "complete"] as const)("忽略迟到的 %s 失败，不重试也不向新文章发送提示", async (boundary) => {
    const target = boundary === "create" ? mocks.createSession : boundary === "batch" ? mocks.batchUpload : mocks.completeSession;
    let reject!: (reason: Error) => void;
    target.mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const notice = vi.fn();
    const { result, rerender } = renderHook(({ novelId }) => useChapterUpload({
      novelId, captureSnapshot: () => ({ document: documentFixture(), coverage: [] }), onNotice: notice,
    }), { wrapper, initialProps: { novelId: "article-a" } });
    await act(async () => result.current.prepare());
    let confirmation!: Promise<void>;
    act(() => { confirmation = result.current.confirm(); });
    await waitFor(() => expect(target).toHaveBeenCalledOnce());
    rerender({ novelId: "article-b" });
    await act(async () => { reject(new Error("迟到的失败")); await confirmation; });
    expect(result.current.diff).toBeNull();
    expect(result.current.hasCheckpoint).toBe(false);
    expect(notice).not.toHaveBeenCalled();
    expect(target).toHaveBeenCalledOnce();
  });


  it("忽略上一篇文章迟到的存储检查点", async () => {
    let release!: (value: unknown) => void;
    mocks.loadCheckpoint.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const notice = vi.fn();
    const { result, rerender } = renderHook(({ novelId }) => useChapterUpload({
      novelId, captureSnapshot: () => ({ document: documentFixture(), coverage: [] }), onNotice: notice,
    }), { wrapper, initialProps: { novelId: "article-a" } });
    rerender({ novelId: "article-b" });
    await act(async () => release({ version: 99, novelId: "article-a" }));
    expect(result.current.diff).toBeNull();
    expect(mocks.deleteCheckpoint).not.toHaveBeenCalled();
    expect(notice).not.toHaveBeenCalled();
  });

  it("旧请求结束时不释放新文章的执行器", async () => {
    let releaseOld!: (value: unknown) => void;
    let releaseNew!: (value: unknown) => void;
    mocks.createSession
      .mockImplementationOnce(() => new Promise((resolve) => { releaseOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { releaseNew = resolve; }));
    const { result, rerender } = renderHook(({ novelId }) => useChapterUpload({
      novelId, captureSnapshot: () => ({ document: documentFixture(), coverage: [] }), onNotice: vi.fn(),
    }), { wrapper, initialProps: { novelId: "article-a" } });
    await act(async () => result.current.prepare());
    let oldConfirmation!: Promise<void>;
    act(() => { oldConfirmation = result.current.confirm(); });
    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(1));
    rerender({ novelId: "article-b" });
    await act(async () => result.current.prepare());
    let newConfirmation!: Promise<void>;
    act(() => { newConfirmation = result.current.confirm(); });
    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(2));
    await act(async () => { releaseOld({ uploadId: "old", staged: [] }); await oldConfirmation; });
    expect(result.current.uploading).toBe(true);
    await act(async () => result.current.confirm());
    expect(mocks.createSession).toHaveBeenCalledTimes(2);
    await act(async () => { releaseNew({ uploadId: "new", staged: ["new", "changed", "same"] }); await newConfirmation; });
    expect(mocks.completeSession).toHaveBeenCalledExactlyOnceWith("article-b", "new");
  });
});
