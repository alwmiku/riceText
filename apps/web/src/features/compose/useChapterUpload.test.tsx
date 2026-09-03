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
  upload: vi.fn(),
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
  uploadLongTextChapter: mocks.upload,
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
    mocks.upload.mockReset().mockResolvedValue({ revision: 5 });
    mocks.hash.mockReset().mockImplementation(async (value: string) => value);
    mocks.gaps.mockReset().mockReturnValue([{ start: 0, end: 2, chars: 2 }]);
    mocks.loadCheckpoint.mockReset().mockResolvedValue(undefined);
    mocks.saveCheckpoint.mockReset().mockResolvedValue(undefined);
    mocks.deleteCheckpoint.mockReset().mockResolvedValue(undefined);
  });

  it("maps sync results and uploads only the frozen changed chapters", async () => {
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

    expect(mocks.upload).toHaveBeenCalledTimes(2);
    expect(mocks.upload).toHaveBeenNthCalledWith(
      1,
      "demo-post",
      "new",
      expect.objectContaining({ title: "新章", order: 0, baseRevision: 0 }),
    );
    expect(mocks.upload).toHaveBeenNthCalledWith(
      2,
      "demo-post",
      "changed",
      expect.objectContaining({ title: "改章", order: 1, baseRevision: 4 }),
    );
    expect(notice).toHaveBeenCalledWith("已分章上传 2 章");
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

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith("服务器章节已是最新版本，无需重复上传");
  });

  it("ignores an unfinished prepare result after switching documents", async () => {
    let resolveDirectory!: (value: unknown[]) => void;
    mocks.list.mockImplementationOnce(
      () => new Promise((resolve) => {
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

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(result.current.diff?.stale).toBe(true);
    expect(result.current.hasCheckpoint).toBe(true);
    expect(notice).toHaveBeenCalledWith("准备上传后正文已有修改，请重新检查差异");
  });

  it("stages reordered chapters outside occupied server positions", async () => {
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
    mocks.upload.mockResolvedValue({ revision: 5 });
    const { result } = renderHook(
      () =>
        useChapterUpload({
          novelId: "demo-post",
          getDocument: reordered,
          getCoverage: () => [],
          onNotice: vi.fn(),
        }),
      { wrapper },
    );

    await act(async () => result.current.prepare());
    await act(async () => result.current.confirm());

    expect(mocks.upload.mock.calls.map((call) => call[2].order)).toEqual([
      3,
      4,
      0,
      1,
    ]);
  });

  it("does not retry a revision conflict with a newer server revision", async () => {
    const oneChapter = () => ({
      type: "doc",
      content: [chapter("changed", "改章", "changed text")],
    });
    mocks.sync.mockResolvedValue({
      toUpdate: ["changed"],
      existing: ["changed"],
    });
    mocks.upload.mockRejectedValue(
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

    mocks.list.mockResolvedValue([{ id: "changed", revision: 5 }]);
    await act(async () => result.current.confirm());
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenLastCalledWith(
      "上传计划存在版本或结构冲突，请重新检查差异",
    );
  });

  it("persists progress and resumes without uploading a successful chapter twice", async () => {
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
    mocks.upload
      .mockResolvedValueOnce({ revision: 1 })
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockResolvedValueOnce({ revision: 5 });
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
    expect(result.current.diff?.uploaded).toBe(1);
    expect(result.current.diff?.rows.map((row) => row.status)).toEqual([
      "已上传",
      "失败",
      "未变化",
    ]);
    expect(result.current.hasCheckpoint).toBe(true);

    await act(async () => result.current.confirm());
    expect(mocks.upload).toHaveBeenCalledTimes(3);
    expect(mocks.upload.mock.calls.map((call) => call[1])).toEqual([
      "new",
      "changed",
      "changed",
    ]);
    expect(result.current.diff?.uploaded).toBe(2);
    expect(result.current.hasCheckpoint).toBe(false);
    expect(mocks.deleteCheckpoint).toHaveBeenCalledWith(
      "ricetext:long-text-upload:demo-post",
    );
  });
});
