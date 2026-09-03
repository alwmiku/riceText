import { act, renderHook } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RichTextNode } from "../../lib/types";
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

const normalDocument: RichTextNode = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "普通正文" }] },
  ],
};

function useHarness(documentId = "article-a") {
  const [content, setContent] = useState<RichTextNode>(normalDocument);
  const contentRef = useRef(content);
  const replaceContent = useCallback((next: RichTextNode) => {
    contentRef.current = next;
    setContent(next);
  }, []);
  const setAutosaveEnabled = useRef(vi.fn()).current;
  const setNotice = useRef(vi.fn()).current;
  const workspace = useLongTextWorkspace({
    documentId,
    content,
    contentRef,
    replaceContent,
    setAutosaveEnabled,
    setNotice,
  });
  return { content, workspace, setAutosaveEnabled };
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

  it("imports chapters, flushes before selection, auto-saves and restores normal content", async () => {
    const { result } = renderHook(() => useHarness());

    await act(async () => result.current.workspace.open());
    expect(result.current.workspace.enabled).toBe(true);
    expect(result.current.setAutosaveEnabled).toHaveBeenCalledWith(false);

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
    expect(result.current.content.content?.[0]?.attrs?.text).toBe(
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
    expect(result.current.content).toEqual(normalDocument);
    expect(result.current.setAutosaveEnabled).toHaveBeenLastCalledWith(true);
  });

  it("keeps the workspace open when the final draft save fails", async () => {
    storage.saveDraft.mockRejectedValueOnce(new Error("quota exceeded"));
    const { result } = renderHook(() => useHarness());

    await act(async () => result.current.workspace.open());
    let closed = true;
    await act(async () => {
      closed = await result.current.workspace.close();
    });

    expect(closed).toBe(false);
    expect(result.current.workspace.enabled).toBe(true);
    expect(result.current.setAutosaveEnabled).toHaveBeenLastCalledWith(false);
  });

  it("ignores an import that finishes after leaving its document", async () => {
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
    expect(result.current.content).toEqual(normalDocument);
    expect(storage.saveRaw).not.toHaveBeenCalled();
  });
});
