import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../../lib/api";
import { ApiError, missingDocument } from "../../lib/api";
import { chapterQueryKeys } from "../../lib/chapter-query-keys";
import { loadLocalDocumentDraft } from "../../lib/local-document-draft-storage";
import { defaultDocument } from "../../lib/seed";
import type { DocumentEnvelope, ForumChapterItem, RichTextNode } from "../../lib/types";
import { useComposeDocument } from "./useComposeDocument";
import { useLongTextWorkspace } from "./useLongTextWorkspace";

const longStorage = vi.hoisted(() => ({
  loadLongTextDraft: vi.fn(), loadLongTextRaw: vi.fn(),
  saveLongTextDraft: vi.fn(), saveLongTextRaw: vi.fn(), deleteLongTextValue: vi.fn(),
}));
vi.mock("../../lib/long-text-draft-storage", () => longStorage);

const api = vi.hoisted(() => ({
  getDocument: vi.fn(), saveDocument: vi.fn(), saveDocumentSteps: vi.fn(),
  listForumChapters: vi.fn(), createDocumentChapter: vi.fn(),
  deleteDocumentChapter: vi.fn(), restoreRevision: vi.fn(),
}));
vi.mock("../../lib/api", async () => ({
  ...await vi.importActual<typeof ApiModule>("../../lib/api"), ...api,
}));

const content = (text: string): RichTextNode => ({
  type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const document = (id: string, revision = 1): DocumentEnvelope => ({
  ...defaultDocument, id, revision, storage: "server", content: content(id),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(first = document("a")) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["document", "a"], first);
  client.setQueryData(["document", "b"], document("b", 8));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(({ id }) => useComposeDocument(id, 0), {
    wrapper, initialProps: { id: "a" },
  }) };
}

function setupWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["document", "a"], document("a"));
  const setNotice = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { setNotice, ...renderHook(() => ({
    compose: useComposeDocument("a", 0),
    workspace: useLongTextWorkspace({ documentId: "a", setNotice }),
  }), { wrapper }) };
}

// 仅替换网络和 IndexedDB 边界；两个领域 Hook、autosave、diff 与普通草稿均为真实实现。
describe("Compose 使用真实 autosave", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.values(api).forEach((mock) => mock.mockReset());
    Object.values(longStorage).forEach((mock) => mock.mockReset().mockResolvedValue(undefined));
    api.getDocument.mockImplementation(async (id: string) => document(id));
    api.listForumChapters.mockResolvedValue([]);
    api.createDocumentChapter.mockImplementation(async (documentId: string, input: { title: string; order: number }) => ({
      ...input, id: `${documentId}-chapter-${input.order}`, documentId, revision: 0, savedAt: defaultDocument.savedAt, hidden: false,
    }));
    api.deleteDocumentChapter.mockResolvedValue({ deleted: true });
  });
  afterEach(() => vi.useRealTimers());

  it("首次创建共享请求，期间新编辑保留为未提交代次并从创建基线继续保存", async () => {
    const create = deferred<DocumentEnvelope>();
    api.saveDocument.mockReturnValueOnce(create.promise);
    const { result } = setup(missingDocument("a"));
    act(() => result.current.createLocalArticle());
    const submitted = content("first");
    act(() => result.current.replaceContent(submitted));
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.ensureServerDocument();
      expect(result.current.ensureServerDocument()).toBe(pending);
    });
    const latest = content("edited while creating");
    act(() => result.current.replaceContent(latest));
    await act(async () => {
      create.resolve({ ...document("a"), content: submitted });
      expect(await pending).toBe("created");
    });
    expect(api.saveDocument).toHaveBeenCalledTimes(1);
    expect(api.saveDocument.mock.calls[0]![1].content).toEqual(submitted);
    expect(result.current.contentRef.current).toEqual(latest);
    expect(loadLocalDocumentDraft("a")).toMatchObject({ baseRevision: 1, content: latest });
    api.saveDocumentSteps.mockResolvedValueOnce({ ...document("a", 2), content: latest });
    await act(async () => expect(await result.current.publishChapter(0)).toBe(true));
    expect(api.saveDocumentSteps.mock.calls[0]![1]).toMatchObject({ baseRevision: 1 });
    expect(result.current.autosave).toMatchObject({ revision: 2, state: "saved" });
    expect(loadLocalDocumentDraft("a")).toBeNull();
  });

  it("创建 409 接纳已有服务器基线，但本地正文仍须上传 steps", async () => {
    api.saveDocument.mockRejectedValueOnce(new ApiError("已存在", 409, undefined, "REVISION_CONFLICT"));
    api.getDocument.mockResolvedValueOnce(document("a", 4));
    const { result } = setup(missingDocument("a"));
    act(() => result.current.createLocalArticle());
    const latest = content("local creation");
    act(() => result.current.replaceContent(latest));
    await act(async () => expect(await result.current.ensureServerDocument()).toBe("existing"));
    expect(result.current.content).toEqual(latest);
    expect(result.current.autosave.revision).toBe(4);
    api.saveDocumentSteps.mockResolvedValueOnce({ ...document("a", 5), content: latest });
    await act(async () => expect(await result.current.autosave.flush()).toBe(true));
    expect(api.saveDocumentSteps.mock.calls[0]![1].baseRevision).toBe(4);
    expect(api.saveDocumentSteps.mock.calls[0]![1].steps.length).toBeGreaterThan(0);
  });

  it("占位 revision 0 不提前恢复旧草稿，查询完成后按真实基线丢弃", async () => {
    const fetched = deferred<DocumentEnvelope>();
    api.getDocument.mockReturnValueOnce(fetched.promise);
    const staleContent = content("stale zero revision draft");
    localStorage.setItem("ricetext:draft:uncached", JSON.stringify({
      documentId: "uncached", baseRevision: 0, content: staleContent, savedAt: defaultDocument.savedAt,
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useComposeDocument("uncached"), { wrapper });
    expect(result.current.generation).toBe(0);
    expect(result.current.content).not.toEqual(staleContent);
    expect(loadLocalDocumentDraft("uncached")?.content).toEqual(staleContent);
    await act(async () => { fetched.resolve(document("uncached", 4)); });
    await waitFor(() => expect(result.current.content).toEqual(document("uncached", 4).content));
    expect(result.current.autosave.revision).toBe(4);
    expect(loadLocalDocumentDraft("uncached")).toBeNull();
  });

  it("查询缓存已有文档时仍恢复匹配 revision 的离线草稿", () => {
    const latest = content("restored cached draft");
    localStorage.setItem("ricetext:draft:a", JSON.stringify({
      documentId: "a", baseRevision: 1, content: latest, savedAt: defaultDocument.savedAt,
    }));
    const { result } = setup();
    expect(result.current.content).toEqual(latest);
    expect(result.current.generation).toBe(1);
    expect(loadLocalDocumentDraft("a")?.content).toEqual(latest);
  });

  it.each(["server", "offline", "409", "422"])("旧文章迟到 %s 保存不触碰新文章或草稿", async (outcome) => {
    const save = deferred<DocumentEnvelope>();
    api.saveDocumentSteps.mockReturnValueOnce(save.promise);
    const { result, rerender, client } = setup();
    act(() => result.current.replaceContent(content("a edited")));
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.autosave.flush(); });
    await waitFor(() => expect(api.saveDocumentSteps).toHaveBeenCalledTimes(1));
    rerender({ id: "b" });
    const latest = content("b local");
    act(() => result.current.replaceContent(latest));
    act(() => result.current.autosave.saveLocal(latest, result.current.generation));
    const draft = loadLocalDocumentDraft("b");
    await act(async () => {
      if (outcome === "409" || outcome === "422") save.reject(new ApiError("迟到的错误", Number(outcome)));
      else save.resolve({ ...document("a", 2), storage: outcome === "offline" ? "local-cache" : "server" });
      expect(await pending).toBe(false);
    });
    expect(result.current.document.id).toBe("b");
    expect(result.current.contentRef.current).toEqual(latest);
    expect(result.current.autosave).toMatchObject({ revision: 8, state: "local-saved", conflictMessage: "" });
    expect(loadLocalDocumentDraft("b")).toEqual(draft);
    expect(loadLocalDocumentDraft("a")?.content).toEqual(content("a edited"));
    expect(client.getQueryData<DocumentEnvelope>(["document", "b"])?.revision).toBe(8);
    api.saveDocumentSteps.mockResolvedValueOnce({ ...document("b", 9), content: latest });
    await act(async () => expect(await result.current.autosave.flush()).toBe(true));
    expect(api.saveDocumentSteps.mock.calls[1]![0]).toBe("b");
    expect(api.saveDocumentSteps.mock.calls[1]![1].baseRevision).toBe(8);
  });

  it("切换后迟到创建不清除当前草稿，回到同 ID 也不接纳旧创建", async () => {
    const create = deferred<DocumentEnvelope>();
    api.saveDocument.mockReturnValueOnce(create.promise);
    const { result, rerender, client } = setup(missingDocument("a"));
    act(() => result.current.createLocalArticle());
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.ensureServerDocument(); });
    rerender({ id: "b" });
    rerender({ id: "a" });
    act(() => result.current.createLocalArticle());
    const latest = content("new a session");
    act(() => result.current.replaceContent(latest));
    act(() => result.current.autosave.saveLocal(latest, result.current.generation));
    await act(async () => {
      create.resolve(document("a", 2));
      expect(await pending).toBe(false);
    });
    expect(result.current.content).toEqual(latest);
    expect(result.current.document.storage).toBe("missing");
    expect(loadLocalDocumentDraft("a")?.content).toEqual(latest);
    expect(client.getQueryData<DocumentEnvelope>(["document", "a"])?.storage).toBe("missing");
  });

  it.each(["list", "create"])("切换后迟到目录 %s 不继续注册或触发新会话保存", async (stage) => {
    const listing = deferred<ForumChapterItem[]>();
    const creation = deferred<ForumChapterItem>();
    const first = document("a");
    first.content = { type: "doc", content: [
      { type: "heading", attrs: { level: 1, chapterStart: true }, content: [{ type: "text", text: "chapter" }] },
      ...content("body").content!,
    ] };
    if (stage === "list") api.listForumChapters.mockReturnValueOnce(listing.promise);
    else api.createDocumentChapter.mockReturnValueOnce(creation.promise);
    const { result, rerender, client } = setup(first);
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.publishChapter(0); });
    await waitFor(() => expect(stage === "list" ? api.listForumChapters : api.createDocumentChapter).toHaveBeenCalledTimes(1));
    rerender({ id: "b" });
    await act(async () => {
      if (stage === "list") listing.resolve([]);
      else creation.resolve({ id: "a-chapter", documentId: "a", title: "chapter", order: 0, revision: 0, savedAt: first.savedAt, hidden: false });
      expect(await pending).toBe(false);
    });
    expect(api.saveDocumentSteps).not.toHaveBeenCalled();
    expect(client.getQueryData(chapterQueryKeys.directory("b"))).toBeUndefined();
    if (stage === "list") expect(api.createDocumentChapter).not.toHaveBeenCalled();
    else expect(client.getQueryData(chapterQueryKeys.directory("a"))).toEqual([]);
    expect(result.current.content).toEqual(document("b").content);
  });

  it("迟到 rollback 不替换新会话正文或 autosave 基线", async () => {
    const restore = deferred<DocumentEnvelope>();
    api.restoreRevision.mockReturnValueOnce(restore.promise);
    const { result, rerender } = setup();
    let pending!: Promise<DocumentEnvelope>;
    act(() => { pending = result.current.rollback(0); });
    rerender({ id: "b" });
    await act(async () => { restore.resolve(document("a", 3)); await pending; });
    expect(result.current.document).toMatchObject({ id: "b", revision: 8 });
    expect(result.current.content).toEqual(document("b").content);
    expect(result.current.autosave.revision).toBe(8);
  });

  it("同文章章节操作失效后 rollback 不更新正文、草稿、缓存或普通基线", async () => {
    const restore = deferred<DocumentEnvelope>();
    api.restoreRevision.mockReturnValueOnce(restore.promise);
    const { result, client } = setup();
    const latest = content("new chapter local edit");
    act(() => result.current.replaceContent(latest));
    act(() => result.current.autosave.saveLocal(latest, result.current.generation));
    const baseline = result.current.document;
    const draft = loadLocalDocumentDraft("a");
    let currentChapter = 0;
    const capturedChapter = currentChapter;
    let pending!: Promise<DocumentEnvelope>;
    act(() => {
      pending = result.current.rollback(0, () => capturedChapter === currentChapter);
    });
    currentChapter = 1;
    const restored = { ...document("a", 3), content: content("obsolete rollback") };
    await act(async () => { restore.resolve(restored); expect(await pending).toEqual(restored); });
    expect(result.current.document).toBe(baseline);
    expect(result.current.contentRef.current).toEqual(latest);
    expect(result.current.generation).toBe(1);
    expect(result.current.autosave).toMatchObject({ revision: 1, state: "local-saved" });
    expect(loadLocalDocumentDraft("a")).toEqual(draft);
    expect(client.getQueryData<DocumentEnvelope>(["document", "a"])?.revision).toBe(1);
  });

  it("有效章节操作的 rollback 仍同时接纳正文和 autosave 基线", async () => {
    const restored = { ...document("a", 3), content: content("restored current chapter") };
    api.restoreRevision.mockResolvedValueOnce(restored);
    const { result, client } = setup();
    act(() => result.current.replaceContent(content("discarded by explicit rollback")));
    await act(async () => expect(await result.current.rollback(0, () => true)).toEqual(restored));
    expect(result.current.contentRef.current).toEqual(restored.content);
    expect(result.current.autosave).toMatchObject({ revision: 3, state: "saved" });
    expect(client.getQueryData<DocumentEnvelope>(["document", "a"])?.revision).toBe(3);
    expect(loadLocalDocumentDraft("a")).toBeNull();
  });

  it.each([409, 422, 0])("普通保存 %s 保留离线草稿且不推进服务器基线", async (status) => {
    const { result } = setup();
    const latest = content("unsaved");
    act(() => result.current.replaceContent(latest));
    if (status) api.saveDocumentSteps.mockRejectedValueOnce(new ApiError("保存无效", status));
    else api.saveDocumentSteps.mockResolvedValueOnce({ ...document("a", 2), storage: "local-cache" });
    await act(async () => expect(await result.current.publishChapter(0)).toBe(false));
    expect(result.current.autosave).toMatchObject({ revision: 1, state: status === 409 ? "conflict" : status === 422 ? "error" : "offline" });
    expect(loadLocalDocumentDraft("a")).toMatchObject({ baseRevision: 1, content: latest });
  });

  it("长文打开、导入、编辑和关闭不暂停普通 autosave 或污染在途保存", async () => {
    const save = deferred<DocumentEnvelope>();
    const importedText = deferred<string>();
    api.saveDocumentSteps.mockReturnValueOnce(save.promise);
    const { result } = setupWorkspace();
    vi.useFakeTimers();
    const submitted = content("ordinary submitted");
    act(() => result.current.compose.replaceContent(submitted));
    let saving!: Promise<boolean>;
    act(() => { saving = result.current.compose.autosave.flush(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.saveDocumentSteps).toHaveBeenCalledTimes(1);

    await act(async () => result.current.workspace.open());
    expect(result.current.workspace.enabled).toBe(true);
    expect(result.current.compose.contentRef.current).toEqual(submitted);
    let importing!: Promise<void>;
    act(() => {
      importing = result.current.workspace.importFile({
        name: "separate-novel.txt", text: () => importedText.promise,
      } as File);
    });
    const latest = content("ordinary edited during long-text import");
    act(() => result.current.compose.replaceContent(latest));
    await act(async () => vi.advanceTimersByTimeAsync(1200));
    expect(result.current.compose.autosave).toMatchObject({ revision: 1, state: "local-saved" });
    expect(loadLocalDocumentDraft("a")).toMatchObject({ baseRevision: 1, content: latest });
    await act(async () => {
      importedText.resolve("第一章 长文\n独立长文正文\n第二章 后续\n另一个章节");
      await importing;
    });
    expect(result.current.workspace.chapterSummaries).toHaveLength(2);
    expect(result.current.workspace.captureUploadSnapshot().document.content?.[0]?.type).toBe("longTextBlock");
    expect(result.current.compose.content).toEqual(latest);
    expect(result.current.compose.generation).toBe(2);
    expect(result.current.compose.document).toMatchObject({ revision: 1, content: document("a").content });

    act(() => result.current.workspace.editChapter(
      result.current.workspace.chapterSummaries[0]!.id, { text: "closing long-text buffer" },
    ));
    await act(async () => expect(await result.current.workspace.close()).toBe(true));
    expect(result.current.workspace.enabled).toBe(false);
    expect(longStorage.saveLongTextDraft).toHaveBeenLastCalledWith("ricetext:local-long-text:a", expect.objectContaining({
      content: expect.arrayContaining([expect.objectContaining({ attrs: expect.objectContaining({ text: "closing long-text buffer" }) })]),
    }));
    expect(result.current.compose.contentRef.current).toEqual(latest);
    expect(result.current.compose.generation).toBe(2);
    expect(api.saveDocumentSteps).toHaveBeenCalledTimes(1);
    await act(async () => {
      save.resolve({ ...document("a", 2), content: submitted });
      expect(await saving).toBe(true);
    });
    expect(result.current.compose.content).toEqual(latest);
    expect(loadLocalDocumentDraft("a")).toMatchObject({ baseRevision: 2, content: latest });
    api.saveDocumentSteps.mockResolvedValueOnce({ ...document("a", 3), content: latest });
    await act(async () => expect(await result.current.compose.autosave.flush()).toBe(true));
    expect(api.saveDocumentSteps.mock.calls[1]![1].baseRevision).toBe(2);
    expect(JSON.stringify(api.saveDocumentSteps.mock.calls[1]![1].steps)).not.toContain("longTextBlock");
    expect(result.current.compose.autosave).toMatchObject({ revision: 3, state: "saved" });
    expect(loadLocalDocumentDraft("a")).toBeNull();
  });

  it("长文关闭落盘失败保留长文缓冲，普通正文与服务器基线均不改变", async () => {
    const { result, setNotice } = setupWorkspace();
    vi.useFakeTimers();
    const ordinary = content("ordinary saved before opening workspace");
    act(() => result.current.compose.replaceContent(ordinary));
    api.saveDocumentSteps.mockResolvedValueOnce({ ...document("a", 2), content: ordinary });
    await act(async () => expect(await result.current.compose.autosave.flush()).toBe(true));
    await act(async () => result.current.workspace.open());
    await act(async () => result.current.workspace.importFile({
      name: "close-failure.txt", text: async () => "第一章 长文\n只属于长文工作台",
    } as File));
    const baseline = result.current.compose.document;
    const generation = result.current.compose.generation;
    act(() => result.current.workspace.editChapter(
      result.current.workspace.chapterSummaries[0]!.id, { text: "retained after quota failure" },
    ));
    longStorage.saveLongTextDraft.mockRejectedValueOnce(new Error("超出存储配额"));
    await act(async () => expect(await result.current.workspace.close()).toBe(false));
    expect(result.current.workspace.enabled).toBe(true);
    expect(result.current.workspace.captureUploadSnapshot().document.content?.[0]?.attrs?.text).toBe("retained after quota failure");
    expect(setNotice).toHaveBeenLastCalledWith("本机草稿自动保存失败，请检查浏览器存储空间");
    expect(result.current.compose.document).toBe(baseline);
    expect(result.current.compose.contentRef.current).toEqual(ordinary);
    expect(result.current.compose.generation).toBe(generation);
    expect(result.current.compose.autosave).toMatchObject({ revision: 2, state: "saved", conflictMessage: "" });
    expect(loadLocalDocumentDraft("a")).toBeNull();
    expect(api.saveDocumentSteps).toHaveBeenCalledTimes(1);

    const nextOrdinary = content("ordinary edits still autosave after long-text failure");
    act(() => result.current.compose.replaceContent(nextOrdinary));
    await act(async () => vi.advanceTimersByTimeAsync(1200));
    expect(loadLocalDocumentDraft("a")).toMatchObject({ baseRevision: 2, content: nextOrdinary });
    expect(result.current.compose.autosave.revision).toBe(2);
    expect(result.current.workspace.captureUploadSnapshot().document.content?.[0]?.attrs?.text).toBe("retained after quota failure");
  });

  it("普通正文持续启用本地 autosave，静默后只保存本地草稿", async () => {
    const { result } = setup();
    vi.useFakeTimers();
    const latest = content("ordinary content");
    act(() => result.current.replaceContent(latest));
    await act(async () => vi.advanceTimersByTimeAsync(1200));
    expect(result.current.autosave.state).toBe("local-saved");
    expect(loadLocalDocumentDraft("a")).toMatchObject({ content: latest, baseRevision: 1 });
    expect(api.saveDocumentSteps).not.toHaveBeenCalled();
  });
});
