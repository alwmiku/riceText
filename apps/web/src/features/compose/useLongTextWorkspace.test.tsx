import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLongTextWorkspace } from "./useLongTextWorkspace";

const storage = vi.hoisted(() => ({
  loadDraft: vi.fn(),
  loadRaw: vi.fn(),
  saveDraft: vi.fn(),
  saveRaw: vi.fn(),
  deleteValue: vi.fn(),
}));

vi.mock("../../lib/long-text-draft-storage", () => ({
  loadLongTextDraft: storage.loadDraft,
  loadLongTextRaw: storage.loadRaw,
  saveLongTextDraft: storage.saveDraft,
  saveLongTextRaw: storage.saveRaw,
  deleteLongTextValue: storage.deleteValue,
}));

function useHarness(documentId = "article-a") {
  const setNotice = useRef(vi.fn()).current;
  const workspace = useLongTextWorkspace({
    documentId,
    setNotice,
  });
  return { workspace, setNotice };
}

describe("useLongTextWorkspace", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    storage.loadDraft.mockReset().mockResolvedValue(undefined);
    storage.loadRaw.mockReset().mockResolvedValue(undefined);
    storage.saveDraft.mockReset().mockResolvedValue(undefined);
    storage.saveRaw.mockReset().mockResolvedValue(undefined);
    storage.deleteValue.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("导入章节，切换前刷新缓冲并自动保存自身草稿", async () => {
    const { result } = renderHook(() => useHarness());

    await act(async () => result.current.workspace.open());
    expect(result.current.workspace.enabled).toBe(true);

    const file = {
      name: "novel.txt",
      text: vi
        .fn()
        .mockResolvedValue("第一章 起点\n旧正文\n第二章 远方\n第二章正文"),
    } as unknown as File;
    await act(async () => result.current.workspace.importFile(file));
    expect(result.current.workspace.chapterSummaries).toHaveLength(2);

    act(() => {
      result.current.workspace.updateEditor({
        type: "doc",
        content: [
          {
            type: "longTextBlock",
            attrs: {
              chapterId: result.current.workspace.chapterSummaries[0]?.id,
              title: "第一章 起点",
              text: "编辑后的正文",
            },
          },
        ],
      });
      result.current.workspace.selectChapter(1);
    });
    expect(result.current.workspace.activeIndex).toBe(1);
    expect(result.current.workspace.captureUploadSnapshot().document.content?.[0]?.attrs?.text).toBe(
      "编辑后的正文",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(storage.saveDraft).toHaveBeenCalled();
    expect(storage.saveRaw).toHaveBeenCalledWith(
      "ricetext:local-long-text-raw:article-a",
      expect.any(String),
    );

    await act(async () => result.current.workspace.clearDraft());
    expect(storage.deleteValue).toHaveBeenCalledWith(
      "ricetext:local-long-text:article-a",
    );
    expect(storage.deleteValue).toHaveBeenCalledWith(
      "ricetext:local-long-text-raw:article-a",
    );

    await act(async () => result.current.workspace.close());
    expect(result.current.workspace.enabled).toBe(false);
  });

  it("最终草稿保存失败时保持工作台开启", async () => {
    storage.saveDraft.mockRejectedValueOnce(new Error("超出存储配额"));
    const { result } = renderHook(() => useHarness());

    await act(async () => result.current.workspace.open());
    let closed = true;
    await act(async () => {
      closed = await result.current.workspace.close();
    });

    expect(closed).toBe(false);
    expect(result.current.workspace.enabled).toBe(true);
  });

  it("忽略离开所属文档后才完成的导入", async () => {
    let resolveText!: (text: string) => void;
    const file = {
      name: "slow.txt",
      text: () =>
        new Promise<string>((resolve) => {
          resolveText = resolve;
        }),
    } as unknown as File;
    const { result, rerender } = renderHook(
      ({ documentId }) => useHarness(documentId),
      { initialProps: { documentId: "article-a" } },
    );

    await act(async () => result.current.workspace.open());
    let importing!: Promise<void>;
    act(() => {
      importing = result.current.workspace.importFile(file);
    });
    await act(async () => result.current.workspace.close());
    rerender({ documentId: "article-b" });
    await act(async () => {
      resolveText("第一章 旧文章\n不应进入新文章");
      await importing;
    });

    expect(result.current.workspace.enabled).toBe(false);
    expect(storage.saveRaw).not.toHaveBeenCalled();
  });

  it("无需外部刷新缓冲即可同时捕获缓冲正文与覆盖信息", async () => {
    const { result } = renderHook(() => useHarness());
    await act(async () => result.current.workspace.open());
    await act(async () => result.current.workspace.addChapter("新章", "旧内容"));
    const id = result.current.workspace.chapterSummaries[0]!.id;
    act(() => result.current.workspace.editChapter(id, { text: "最新内容六个字" }));
    let snapshot!: ReturnType<typeof result.current.workspace.captureUploadSnapshot>;
    act(() => { snapshot = result.current.workspace.captureUploadSnapshot(); });
    expect(snapshot.document.content?.[0]?.attrs?.text).toBe("最新内容六个字");
    expect(snapshot.coverage[0]?.charCount).toBe("最新内容六个字".length);
    expect(snapshot.coverage[0]?.id).toBe(id);
    act(() => result.current.workspace.editChapter(id, { text: "后续修改" }));
    act(() => { result.current.workspace.captureUploadSnapshot(); });
    expect(snapshot.document.content?.[0]?.attrs?.text).toBe("最新内容六个字");
  });

  it("未显式关闭时切换文档也会丢弃旧编辑器缓冲", async () => {
    const { result, rerender } = renderHook(({ documentId }) => useHarness(documentId),
      { initialProps: { documentId: "article-a" } });
    await act(async () => result.current.workspace.open());
    await act(async () => result.current.workspace.addChapter("旧章", "旧正文"));
    act(() => result.current.workspace.updateEditor({ type: "doc", content: [
      { type: "longTextBlock", attrs: { chapterId: "old", title: "旧章", text: "缓冲" } },
    ] }));
    rerender({ documentId: "article-b" });
    await act(async () => result.current.workspace.open());
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(result.current.workspace.chapterSummaries).toEqual([]);
    expect(storage.saveDraft).not.toHaveBeenCalledWith("ricetext:local-long-text:article-b",
      expect.objectContaining({ content: [expect.objectContaining({ attrs: expect.objectContaining({ text: "缓冲" }) })] }));
  });

  it("切换文档后忽略迟到的关闭失败", async () => {
    let rejectSave!: (error: Error) => void;
    storage.saveDraft.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; }));
    const { result, rerender } = renderHook(({ documentId }) => useHarness(documentId),
      { initialProps: { documentId: "article-a" } });
    await act(async () => result.current.workspace.open());
    let closing!: Promise<boolean>;
    act(() => { closing = result.current.workspace.close(); });
    rerender({ documentId: "article-b" });
    await act(async () => result.current.workspace.open());
    result.current.setNotice.mockClear();
    await act(async () => { rejectSave(new Error("超出存储配额")); expect(await closing).toBe(false); });
    expect(result.current.workspace.enabled).toBe(true);
    expect(result.current.setNotice).not.toHaveBeenCalled();
  });
});
