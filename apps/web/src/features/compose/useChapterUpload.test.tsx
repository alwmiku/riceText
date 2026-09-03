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
  uploadLongTextChaptersBatch: mocks.batchUpload,
  stageLongTextChapterReorder: mocks.stage,
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
  });

  it("creates a missing server document before requesting chapter differences", async () => {
    const ensureDocument = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "article-local",
          getDocument: documentFixture,
          getCoverage: () => [],
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

  it("closes the dialog and pauses after the current atomic batch", async () => {
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
          getDocument: oneChapter,
          getCoverage: () => [],
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
  });

  it("maps sync results and uploads changed chapters in one batch without longTextBlock", async () => {
    const document = documentFixture();
    const notice = vi.fn();
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          getDocument: () => document,
          getCoverage: () => [],
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    expect(result.current.diff).toMatchObject({
      total: 3,
      toUpdate: 2,
      added: 1,
      modified: 1,
      gaps: 1,
    });
    expect(result.current.diff?.rows.map((row) => row.action)).toEqual([
      "新增",
      "修改",
      "未变化",
    ]);
    expect(result.current.diff?.rows.map((row) => row.status)).toEqual([
      "待上传",
      "待上传",
      "未变化",
    ]);

    await act(async () => result.current.confirm());

    expect(mocks.batchUpload).toHaveBeenCalledTimes(1);
    const [novelId, payload] = mocks.batchUpload.mock.calls[0] as [
      string,
      Array<Record<string, unknown>>,
    ];
    expect(novelId).toBe("demo-post");
    expect(payload.map((item) => item.id)).toEqual(["new", "changed"]);
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
    expect(notice).toHaveBeenCalledWith("已分章上传 2 章");
    expect(mocks.saveCheckpoint).toHaveBeenCalled();
    const lastSaved = mocks.saveCheckpoint.mock.calls.at(-1)?.[1] as {
      version: number;
      chapters: Array<Record<string, unknown>>;
    };
    expect(lastSaved.version).toBe(2);
    expect(
      lastSaved.chapters.every((entry) => !("content" in entry)),
    ).toBe(true);
  });

  it("splits 3000 chapters into 150 batches of at most 20 chapters", async () => {
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
          getDocument: () => manyChapters,
          getCoverage: () => [],
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
    expect(notice).toHaveBeenCalledWith("已分章上传 3000 章");
  });

  it("bisects a 413 batch into halves until single chapters", async () => {
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
          getDocument: four,
          getCoverage: () => [],
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
    expect(result.current.diff?.uploaded).toBe(4);
    expect(result.current.hasCheckpoint).toBe(false);
  });

  it("retries 429 up to the retry budget with backoff and succeeds", async () => {
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
          getDocument: one,
          getCoverage: () => [],
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    await act(async () => result.current.confirm());

    expect(mocks.batchUpload).toHaveBeenCalledTimes(3);
    expect(result.current.diff?.rows[0]).toMatchObject({ status: "已上传" });
    expect(notice).toHaveBeenCalledWith("已分章上传 1 章");
  });

  it("does not retry a 409 conflict and keeps the checkpoint", async () => {
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
          getDocument: oneChapter,
          getCoverage: () => [],
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    await act(async () => result.current.confirm());
    expect(result.current.diff?.rows[0]).toMatchObject({
      status: "失败",
      retryable: false,
    });
    expect(mocks.batchUpload).toHaveBeenCalledTimes(1);
    expect(result.current.hasCheckpoint).toBe(true);

    mocks.list.mockResolvedValue([{ id: "changed", revision: 5 }]);
    await act(async () => result.current.confirm());
    expect(mocks.batchUpload).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenLastCalledWith(
      "上传计划存在版本或结构冲突，请重新检查差异",
    );
    expect(result.current.diff?.rows[0]).toMatchObject({
      status: "失败",
      retryable: false,
    });
  });

  it("closes an unchanged plan without issuing uploads", async () => {
    mocks.sync.mockResolvedValueOnce({
      toUpdate: [],
      existing: ["new", "changed", "same"],
    });
    const notice = vi.fn();
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          getDocument: documentFixture,
          getCoverage: () => [],
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    expect(result.current.diff?.toUpdate).toBe(0);
    await act(async () => result.current.confirm());

    expect(mocks.batchUpload).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith("服务器章节已是最新版本，无需重复上传");
  });

  it("ignores an unfinished prepare result after switching documents", async () => {
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
          getDocument: documentFixture,
          getCoverage: () => [],
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

  it("marks a frozen plan stale when the document changes before upload", async () => {
    let document = documentFixture();
    const notice = vi.fn();
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          getDocument: () => document,
          getCoverage: () => [],
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

    expect(mocks.batchUpload).not.toHaveBeenCalled();
    expect(result.current.diff?.stale).toBe(true);
    expect(result.current.hasCheckpoint).toBe(true);
    expect(notice).toHaveBeenCalledWith("准备上传后正文已有修改，请重新检查差异");
  });

  it("stages reordered chapters outside occupied server positions before the content batch", async () => {
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
          getDocument: reordered,
          getCoverage: () => [],
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    await act(async () => result.current.confirm());

    expect(mocks.stage).toHaveBeenCalledTimes(1);
    const [stageNovelId, stagePayload] = mocks.stage.mock.calls[0] as [
      string,
      Array<Record<string, unknown>>,
    ];
    expect(stageNovelId).toBe("demo-post");
    expect(
      stagePayload.map((item) => [
        item.id,
        item.temporaryOrder,
        item.baseRevision,
      ]),
    ).toEqual([
      ["changed", 3, 4],
      ["same", 4, 2],
    ]);
    const batchPayload = mocks.batchUpload.mock.calls[0]?.[1] as Array<
      Record<string, unknown>
    >;
    expect(
      batchPayload.map((item) => [item.id, item.order, item.baseRevision]),
    ).toEqual([
      ["changed", 0, 5],
      ["same", 1, 3],
    ]);
    expect(result.current.diff?.uploaded).toBe(2);
  });

  it("persists progress and resumes without re-uploading chapters already current", async () => {
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
          getDocument: documentFixture,
          getCoverage: () => [],
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    await act(async () => result.current.confirm());
    expect(result.current.diff?.rows.map((row) => row.status)).toEqual([
      "失败",
      "失败",
      "未变化",
    ]);
    expect(result.current.hasCheckpoint).toBe(true);

    await act(async () => result.current.confirm());
    const ids = mocks.batchUpload.mock.calls.map(
      (call) => ((call[1] as Array<{ id: string }>).map((item) => item.id)).join(","),
    );
    // 首次重试了 4 次（1 次 + 3 次退避），恢复时 new 已是最新，只重发 changed。
    expect(ids[ids.length - 1]).toBe("changed");
    expect(result.current.diff?.uploaded).toBe(2);
    expect(result.current.hasCheckpoint).toBe(false);
    expect(mocks.deleteCheckpoint).toHaveBeenCalledWith(
      "ricetext:long-text-upload:demo-post",
    );
  });

  it("migrates a v1 checkpoint to v2 and removes embedded content", async () => {
    const document = documentFixture();
    // 先正常 prepare 一次拿到 v2 计划，再改造成 v1 并从 IndexedDB 恢复。
    const first = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          getDocument: () => document,
          getCoverage: () => [],
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
    expect(saved.version).toBe(2);
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
    mocks.loadCheckpoint.mockResolvedValue(v1Checkpoint);
    mocks.list.mockResolvedValue([]);
    mocks.sync.mockResolvedValue({
      toUpdate: (document.content ?? []).map((node) => String(node.attrs?.chapterId)),
      existing: [],
    });
    const notice = vi.fn();
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          getDocument: () => document,
          getCoverage: () => [],
          onNotice: notice,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.hasCheckpoint).toBe(true));
    const migratedSave = mocks.saveCheckpoint.mock.calls.at(-1)?.[1] as {
      version: number;
      chapters: Array<Record<string, unknown>>;
    };
    expect(migratedSave.version).toBe(2);
    expect(
      migratedSave.chapters.every((entry) => !("content" in entry)),
    ).toBe(true);

    await act(async () => result.current.confirm());
    expect(notice).toHaveBeenCalledWith("已分章上传 2 章");
    expect(mocks.deleteCheckpoint).toHaveBeenCalledWith(
      "ricetext:long-text-upload:demo-post",
    );
  });

  it("rejects a v1 checkpoint that does not match the current draft without deleting the draft", async () => {
    const document = documentFixture();
    const wrongSourceV1 = {
      version: 1,
      novelId: "demo-post",
      sourceHash: "different-source-hash",
      stale: false,
      gaps: 0,
      chapters: [],
    };
    mocks.loadCheckpoint.mockResolvedValue(wrongSourceV1);
    const notice = vi.fn();
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          getDocument: () => document,
          getCoverage: () => [],
          onNotice: notice,
        }),
      { wrapper },
    );

    await waitFor(() =>
      expect(notice).toHaveBeenCalledWith(
        "原有上传计划与当前草稿不一致，请重新检查差异",
      ),
    );
    expect(result.current.hasCheckpoint).toBe(false);
    expect(mocks.deleteCheckpoint).toHaveBeenCalledWith(
      "ricetext:long-text-upload:demo-post",
    );
  });

  it("flags a chapter over 1.8 MiB at prepare and skips uploading it", async () => {
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
          getDocument: () => huge,
          getCoverage: () => [],
          onNotice: notice,
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    expect(result.current.diff?.rows[0]).toMatchObject({
      status: "失败",
      retryable: false,
    });
    expect(result.current.diff?.rows[0]?.error).toContain("巨型章");
    await act(async () => result.current.confirm());
    // 只有小章进入批量上传。
    const ids = mocks.batchUpload.mock.calls.flatMap(
      (call) => (call[1] as Array<{ id: string }>).map((item) => item.id),
    );
    expect(ids).toEqual(["small"]);
    expect(notice).toHaveBeenLastCalledWith(
      "其余章节存在版本、结构或大小冲突，需要重新检查差异",
    );
  });
});