import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../../../lib/api";
import { defaultDocument } from "../../../lib/seed";
import type { DocumentEnvelope, RichTextNode } from "../../../lib/types";
import { ApiError } from "../../../lib/api";
import { useAutosave } from "./useAutosave";

const { saveDocumentStepsMock } = vi.hoisted(() => ({
  saveDocumentStepsMock: vi.fn(),
}));

vi.mock("../../../lib/api", async () => {
  const actual = await vi.importActual<typeof ApiModule>("../../../lib/api");
  return { ...actual, saveDocumentSteps: saveDocumentStepsMock };
});

const initialContent = defaultDocument.content;
const changedContent: RichTextNode = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "changed" }] }],
};
const newestContent: RichTextNode = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "newest" }] }],
};

function savedDocument(
  revision: number,
  content: RichTextNode = changedContent,
  storage: DocumentEnvelope["storage"] = "server",
): DocumentEnvelope {
  return {
    ...defaultDocument,
    revision,
    savedAt: `2026-08-20T00:00:0${revision % 10}.000Z`,
    content,
    storage,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("useAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    saveDocumentStepsMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("停止输入 1.2 秒后只保存本地草稿，不请求服务器", async () => {
    const { result, rerender } = renderHook(
      ({ content, generation }) =>
        useAutosave({ document: defaultDocument, content, generation }),
      { initialProps: { content: initialContent, generation: 0 } },
    );

    rerender({ content: changedContent, generation: 1 });
    expect(result.current.state).toBe("dirty");
    await act(async () => vi.advanceTimersByTimeAsync(1200));

    expect(saveDocumentStepsMock).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      state: "local-saved",
      revision: defaultDocument.revision,
    });
    expect(
      JSON.parse(localStorage.getItem("ricetext:draft:demo-post")!),
    ).toMatchObject({
      documentId: "demo-post",
      baseRevision: defaultDocument.revision,
      content: changedContent,
    });
  });

  it("显式 flush 才上传最小 steps，成功后清除本地草稿", async () => {
    const onSaved = vi.fn();
    saveDocumentStepsMock.mockResolvedValueOnce(savedDocument(19));
    const { result, rerender } = renderHook(
      ({ content, generation }) =>
        useAutosave({
          document: defaultDocument,
          content,
          generation,
          chapterId: "chapter-1",
          onSaved,
        }),
      { initialProps: { content: initialContent, generation: 0 } },
    );
    rerender({ content: changedContent, generation: 1 });
    await act(async () => vi.advanceTimersByTimeAsync(1200));

    await act(async () => {
      expect(await result.current.flush()).toBe(true);
    });
    expect(saveDocumentStepsMock).toHaveBeenCalledWith(
      "demo-post",
      expect.objectContaining({
        schemaVersion: 1,
        baseRevision: 18,
        chapterId: "chapter-1",
        clientMutationId: expect.stringMatching(/^save_/),
        steps: expect.any(Array),
      }),
    );
    expect(saveDocumentStepsMock.mock.calls[0]![1].steps.length).toBeGreaterThan(0);
    expect(result.current).toMatchObject({ state: "saved", revision: 19 });
    expect(localStorage.getItem("ricetext:draft:demo-post")).toBeNull();
    expect(onSaved).toHaveBeenCalledWith(savedDocument(19));
  });

  it("正文没有服务器差异时显式保存不发送空请求", async () => {
    const { result } = renderHook(() =>
      useAutosave({
        document: defaultDocument,
        content: initialContent,
        generation: 0,
      }),
    );
    await act(async () => {
      expect(await result.current.flush()).toBe(true);
    });
    expect(saveDocumentStepsMock).not.toHaveBeenCalled();
  });

  it("多个显式保存请求串行执行，并让后一请求使用新的 revision", async () => {
    const first = deferred<DocumentEnvelope>();
    saveDocumentStepsMock
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(savedDocument(20, newestContent));
    const { result, rerender } = renderHook(
      ({ content, generation }) =>
        useAutosave({ document: defaultDocument, content, generation }),
      { initialProps: { content: changedContent, generation: 1 } },
    );

    let firstSave!: Promise<boolean>;
    act(() => {
      firstSave = result.current.flush(changedContent, 1);
    });
    rerender({ content: newestContent, generation: 2 });
    let secondSave!: Promise<boolean>;
    act(() => {
      secondSave = result.current.flush(newestContent, 2);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(saveDocumentStepsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve(savedDocument(19));
      await firstSave;
      await secondSave;
    });
    expect(saveDocumentStepsMock).toHaveBeenCalledTimes(2);
    expect(saveDocumentStepsMock.mock.calls[1]![1]).toMatchObject({
      baseRevision: 19,
    });
    expect(result.current.revision).toBe(20);
  });

  it("409 时保留本地草稿并进入冲突状态", async () => {
    saveDocumentStepsMock.mockRejectedValueOnce(
      new ApiError("版本冲突", 409, {
        currentRevision: 22,
      }),
    );
    const { result } = renderHook(() =>
      useAutosave({
        document: defaultDocument,
        content: changedContent,
        generation: 1,
      }),
    );

    await act(async () => {
      expect(await result.current.flush()).toBe(false);
    });
    expect(result.current.state).toBe("conflict");
    expect(result.current.conflictMessage).toContain("服务器已有更新版本");
    expect(localStorage.getItem("ricetext:draft:demo-post")).not.toBeNull();
  });

  it("离线响应只保留本地状态，不推进服务器 revision", async () => {
    const onSaved = vi.fn();
    saveDocumentStepsMock.mockResolvedValueOnce(
      savedDocument(19, changedContent, "local-cache"),
    );
    const { result } = renderHook(() =>
      useAutosave({
        document: defaultDocument,
        content: changedContent,
        generation: 1,
        onSaved,
      }),
    );

    await act(async () => {
      expect(await result.current.flush()).toBe(false);
    });
    expect(result.current).toMatchObject({ state: "offline", revision: 18 });
    expect(onSaved).not.toHaveBeenCalled();
    expect(localStorage.getItem("ricetext:draft:demo-post")).not.toBeNull();
  });

  it("disabled 时既不自动写本地也不上传服务器", async () => {
    const { result, rerender } = renderHook(
      ({ content, generation }) =>
        useAutosave({
          document: defaultDocument,
          content,
          generation,
          enabled: false,
        }),
      { initialProps: { content: initialContent, generation: 0 } },
    );
    rerender({ content: changedContent, generation: 1 });
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    await act(async () => {
      expect(await result.current.flush()).toBe(true);
    });
    expect(localStorage.getItem("ricetext:draft:demo-post")).toBeNull();
    expect(saveDocumentStepsMock).not.toHaveBeenCalled();
  });
});
