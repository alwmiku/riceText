import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../../lib/api";
import { defaultDocument } from "../../lib/seed";
import type { DocumentEnvelope, RichTextNode } from "../../lib/types";
import { useAutosave } from "./useAutosave";

const { saveDocumentMock } = vi.hoisted(() => ({ saveDocumentMock: vi.fn() }));

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof ApiModule>("../../lib/api");
  return { ...actual, saveDocument: saveDocumentMock };
});

const initialContent = defaultDocument.content;
const changedContent: RichTextNode = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "changed" }] },
  ],
};

function savedDocument(
  revision: number,
  storage: DocumentEnvelope["storage"] = "server",
): DocumentEnvelope {
  return {
    ...defaultDocument,
    revision,
    savedAt: `2026-08-20T00:00:0${revision % 10}.000Z`,
    content: changedContent,
    storage,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("useAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveDocumentMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("根据文档落点初始化状态，并在文档修订变化时同步", () => {
    const local: DocumentEnvelope = {
      ...defaultDocument,
      storage: "local-demo",
    };
    const { result, rerender } = renderHook(
      ({ document }) =>
        useAutosave({ document, content: document.content, generation: 0 }),
      { initialProps: { document: local } },
    );
    expect(result.current.state).toBe("offline");
    expect(result.current.revision).toBe(18);

    rerender({ document: savedDocument(21) });
    expect(result.current.state).toBe("saved");
    expect(result.current.revision).toBe(21);
  });

  it("停止输入 1.2 秒后保存并通知宿主", async () => {
    const onSaved = vi.fn();
    saveDocumentMock.mockResolvedValueOnce(savedDocument(19));
    const { result, rerender } = renderHook(
      ({ content, generation }) =>
        useAutosave({
          document: defaultDocument,
          content,
          generation,
          onSaved,
        }),
      { initialProps: { content: initialContent, generation: 0 } },
    );

    rerender({ content: changedContent, generation: 1 });
    expect(result.current.state).toBe("dirty");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1199);
    });
    expect(saveDocumentMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(saveDocumentMock).toHaveBeenCalledWith(
      "demo-post",
      expect.objectContaining({
        schemaVersion: 1,
        baseRevision: 18,
        content: changedContent,
        clientMutationId: expect.stringMatching(/^save_/),
      }),
    );
    expect(result.current).toMatchObject({
      state: "saved",
      revision: 19,
      savedAt: savedDocument(19).savedAt,
    });
    expect(onSaved).toHaveBeenCalledWith(savedDocument(19));
  });

  it("flush 立即保存，并正确标记本地演示副本", async () => {
    saveDocumentMock.mockResolvedValueOnce(savedDocument(19, "local-demo"));
    const { result, rerender } = renderHook(
      ({ content, generation }) =>
        useAutosave({ document: defaultDocument, content, generation }),
      { initialProps: { content: initialContent, generation: 0 } },
    );
    rerender({ content: changedContent, generation: 1 });

    await act(async () => {
      await result.current.flush();
    });

    expect(result.current.state).toBe("offline");
    expect(result.current.revision).toBe(19);
  });

  it("把同时触发的保存串行化，并让后一请求使用新修订号", async () => {
    const first = deferred<DocumentEnvelope>();
    const second = deferred<DocumentEnvelope>();
    saveDocumentMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(
      ({ content, generation }) =>
        useAutosave({ document: defaultDocument, content, generation }),
      { initialProps: { content: initialContent, generation: 0 } },
    );

    rerender({ content: changedContent, generation: 1 });
    let firstFlush!: Promise<void>;
    act(() => {
      firstFlush = result.current.flush();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(saveDocumentMock).toHaveBeenCalledTimes(1);

    const newestContent: RichTextNode = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "newest" }] },
      ],
    };
    rerender({ content: newestContent, generation: 2 });
    let secondFlush!: Promise<void>;
    act(() => {
      secondFlush = result.current.flush();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(saveDocumentMock).toHaveBeenCalledTimes(1);

    first.resolve(savedDocument(19));
    await act(async () => {
      await firstFlush;
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(saveDocumentMock).toHaveBeenCalledTimes(2);
    expect(saveDocumentMock.mock.calls[1]![1]).toMatchObject({
      baseRevision: 19,
      content: newestContent,
    });

    second.resolve({ ...savedDocument(20), content: newestContent });
    await act(async () => {
      await secondFlush;
    });
    expect(result.current).toMatchObject({ state: "saved", revision: 20 });
  });

  it("409 时保留本地内容，接受最新修订后可以继续保存", async () => {
    const { ApiError } = await import("../../lib/api");
    saveDocumentMock.mockRejectedValueOnce(
      new ApiError("conflict", 409, { latestRevision: 25 }),
    );
    const { result, rerender } = renderHook(
      ({ content, generation }) =>
        useAutosave({ document: defaultDocument, content, generation }),
      { initialProps: { content: initialContent, generation: 0 } },
    );
    rerender({ content: changedContent, generation: 1 });

    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.state).toBe("conflict");
    expect(result.current.conflictMessage).toContain("服务器已有更新版本");

    act(() => {
      result.current.acceptLatest(25);
    });
    expect(result.current).toMatchObject({
      state: "dirty",
      revision: 25,
      conflictMessage: "",
    });

    saveDocumentMock.mockResolvedValueOnce(savedDocument(26));
    await act(async () => {
      await result.current.flush();
    });
    expect(saveDocumentMock.mock.calls[1]![1]).toMatchObject({
      baseRevision: 25,
    });
    expect(result.current.state).toBe("saved");
  });

  it("普通异常保持 error 且不循环重试，新内容代次可以再次保存", async () => {
    saveDocumentMock.mockRejectedValueOnce(new Error("磁盘暂不可写"));
    const { result, rerender } = renderHook(
      ({ content, generation }) =>
        useAutosave({ document: defaultDocument, content, generation }),
      { initialProps: { content: initialContent, generation: 0 } },
    );
    rerender({ content: changedContent, generation: 1 });

    await act(async () => {
      await result.current.flush();
    });

    expect(result.current).toMatchObject({
      state: "error",
      conflictMessage: "磁盘暂不可写",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(saveDocumentMock).toHaveBeenCalledTimes(1);

    saveDocumentMock.mockResolvedValueOnce(savedDocument(19));
    await act(async () => {
      await result.current.flush();
    });
    expect(saveDocumentMock).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ state: "saved", revision: 19 });

    const newestContent: RichTextNode = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "retry" }] },
      ],
    };
    saveDocumentMock.mockResolvedValueOnce({
      ...savedDocument(19),
      content: newestContent,
    });
    rerender({ content: newestContent, generation: 2 });
    expect(result.current.state).toBe("dirty");
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current).toMatchObject({ state: "saved", revision: 19 });
  });
});
