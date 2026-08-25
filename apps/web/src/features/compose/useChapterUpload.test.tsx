import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RichTextNode } from "../../lib/types";
import { useChapterUpload } from "./useChapterUpload";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  sync: vi.fn(),
  upload: vi.fn(),
  hash: vi.fn(),
  gaps: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  listDemoChapters: mocks.list,
  syncLongTextChapters: mocks.sync,
  uploadLongTextChapter: mocks.upload,
}));
vi.mock("../../lib/utils", () => ({ sha256Hex: mocks.hash }));
vi.mock("../novel/ChapterRawPreview", () => ({ collectRawGaps: mocks.gaps }));

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
      { id: "changed", revision: 4 },
      { id: "same", revision: 2 },
    ]);
    mocks.sync.mockReset().mockResolvedValue({
      toUpdate: ["new", "changed"],
      existing: ["changed", "same"],
    });
    mocks.upload.mockReset().mockResolvedValue({ revision: 5 });
    mocks.hash.mockReset().mockImplementation(async (value: string) => value);
    mocks.gaps.mockReset().mockReturnValue([{ start: 0, end: 2, chars: 2 }]);
  });

  it("maps sync results and uploads only the frozen changed chapters", async () => {
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
    expect(result.current.diff).toMatchObject({
      total: 3,
      toUpdate: 2,
      added: 1,
      modified: 1,
      gaps: 1,
    });
    expect(result.current.diff?.rows.map((row) => row.status)).toEqual([
      "新增",
      "修改",
      "未变化",
    ]);

    document = {
      type: "doc",
      content: [chapter("new", "准备后改名", "later text")],
    };
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
});
