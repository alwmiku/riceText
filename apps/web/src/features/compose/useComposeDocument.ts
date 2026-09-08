import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDocumentChapter,
  deleteDocumentChapter,
  getDocument,
  listForumChapters,
  missingDocument,
  restoreRevision,
  saveDocument,
} from "../../lib/api";
import {
  clearLocalDocumentDraft,
  loadLocalDocumentDraft,
} from "../../lib/local-document-draft-storage";
import { mergeChapter, splitDocumentByHeadings } from "../../lib/chapters";
import { createId } from "../../lib/utils";
import { chapterQueryKeys } from "../../lib/chapter-query-keys";
import type {
  DocumentEnvelope,
  ForumChapterItem,
  RichTextNode,
} from "../../lib/types";
import { useAutosave } from "../editor/hooks/useAutosave";

export interface ComposeDocumentController {
  document: DocumentEnvelope;
  content: RichTextNode;
  contentRef: MutableRefObject<RichTextNode>;
  generation: number;
  isPlaceholderData: boolean;
  /** 服务器已有文章或用户已在本地点击创建。 */
  articleStarted: boolean;
  autosave: ReturnType<typeof useAutosave>;
  replaceContent: (next: RichTextNode) => void;
  createLocalArticle: () => void;
  ensureServerDocument: () => Promise<"created" | "existing" | false>;
  updateChapter: (chapterIndex: number, chapter: RichTextNode) => void;
  publishChapter: (
    chapterIndex: number,
    latestChapter?: RichTextNode,
  ) => Promise<boolean>;
  rollback: (
    revision: number,
    isOperationCurrent?: () => boolean,
  ) => Promise<DocumentEnvelope>;
}

/** 管理服务器文档、编辑代次、自动保存、显式发布和版本回滚。 */
export function useComposeDocument(
  documentId: string,
  chapterIndex?: number,
  options: {
    serverEnabled?: boolean;
    localOnly?: boolean;
    initialTitle?: string | undefined;
  } = {},
): ComposeDocumentController {
  const serverEnabled = options.serverEnabled ?? true;
  const localOnly = options.localOnly ?? false;
  const queryClient = useQueryClient();
  const placeholder = useMemo(() => {
    const missing = {
      ...missingDocument(documentId),
      ...(options.initialTitle ? { title: options.initialTitle } : {}),
    };
    return localOnly
      ? {
          ...missing,
          content: { type: "doc", content: [{ type: "paragraph" }] },
        }
      : missing;
  }, [documentId, localOnly, options.initialTitle]);
  const { data = placeholder, isPlaceholderData: queryIsPlaceholderData } =
    useQuery({
      queryKey: ["document", documentId],
      queryFn: ({ signal }) => getDocument(documentId, signal),
      placeholderData: placeholder,
      enabled: serverEnabled,
    });
  // state 驱动渲染，ref 让 autosave、发布和长文本桥接始终读取最新正文与代次。
  const [initialDraft] = useState(() => {
    const draft = loadLocalDocumentDraft(documentId);
    // 占位 revision 不是服务端基线；先等待查询，再决定是否恢复旧草稿。
    return draft &&
      (!serverEnabled ||
        (!queryIsPlaceholderData && draft.baseRevision === data.revision))
      ? draft
      : null;
  });
  const [document, setDocument] = useState<DocumentEnvelope>(data);
  const [content, setContent] = useState<RichTextNode>(
    initialDraft?.content ?? data.content,
  );
  const [generation, setGeneration] = useState(initialDraft ? 1 : 0);
  const [articleStarted, setArticleStarted] = useState(
    localOnly || data.storage !== "missing" || Boolean(initialDraft),
  );
  const contentRef = useRef<RichTextNode>(content);
  const generationRef = useRef(generation);
  const sessionRef = useRef({ documentId });
  const creationRef = useRef<Promise<"created" | "existing" | false> | null>(
    null,
  );
  const rollbackEpochRef = useRef(0);
  if (sessionRef.current.documentId !== documentId) {
    sessionRef.current = { documentId };
    creationRef.current = null;
    const storedDraft = loadLocalDocumentDraft(documentId);
    const draft =
      storedDraft &&
      (!serverEnabled ||
        (!queryIsPlaceholderData && storedDraft.baseRevision === data.revision))
        ? storedDraft
        : null;
    const nextContent = draft?.content ?? data.content;
    const nextGeneration = draft ? 1 : 0;
    setDocument(data);
    setArticleStarted(
      localOnly || data.storage !== "missing" || Boolean(draft),
    );
    contentRef.current = nextContent;
    generationRef.current = nextGeneration;
    setContent(nextContent);
    setGeneration(nextGeneration);
  }
  const session = sessionRef.current;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const isCurrent = useCallback(
    () => mountedRef.current && sessionRef.current === session,
    [session],
  );
  // 章节身份按正文中的位置派生（chapter-<index>）：编辑器「新增章节」在服务端
  // 目录落库前也能拿到稳定 id，保存时按该 id 归集历史与独立章节版本号。
  const chapterId = useMemo(
    () =>
      chapterIndex == null || chapterIndex < 0
        ? undefined
        : splitDocumentByHeadings(content).chapters[chapterIndex]?.id,
    [chapterIndex, content],
  );
  // Query 结束到本地 state 水合之间仍视为加载中，避免编辑器在这一帧上报占位正文。
  const hydrationPending = generationRef.current === 0 && data !== document;
  const isDocumentLoading =
    serverEnabled && (queryIsPlaceholderData || hydrationPending);

  // 占位文档的 revision 只是占位元数据，不能作为服务器版本的新旧依据。
  // 首次真实编辑发生前始终接纳查询结果；编辑后则由 generationRef 阻止迟到响应覆盖正文。
  useEffect(() => {
    if (serverEnabled && queryIsPlaceholderData) return;
    if (generationRef.current !== 0) {
      if (document.storage === "missing" && data.storage === "server")
        setDocument(data);
      return;
    }
    if (data === document) return;
    setDocument(data);
    const draft = loadLocalDocumentDraft(documentId);
    const restoreDraft = draft?.baseRevision === data.revision;
    if (draft && !restoreDraft) clearLocalDocumentDraft(documentId);
    const nextContent = draft && restoreDraft ? draft.content : data.content;
    const nextGeneration = restoreDraft ? 1 : 0;
    setArticleStarted(
      localOnly || data.storage !== "missing" || Boolean(restoreDraft),
    );
    contentRef.current = nextContent;
    generationRef.current = nextGeneration;
    setContent(nextContent);
    setGeneration(nextGeneration);
  }, [
    data,
    document,
    documentId,
    localOnly,
    queryIsPlaceholderData,
    serverEnabled,
  ]);

  const replaceContent = useCallback((next: RichTextNode) => {
    contentRef.current = next;
    generationRef.current += 1;
    setContent(next);
    setGeneration(generationRef.current);
  }, []);

  const createLocalArticle = useCallback(() => {
    if (articleStarted) return;
    // 空段落只存在浏览器草稿中，用户点击「保存」后才创建 D1 文档和首个版本。
    const blank: RichTextNode = {
      type: "doc",
      content: [{ type: "paragraph" }],
    };
    setArticleStarted(true);
    replaceContent(blank);
  }, [articleStarted, replaceContent]);

  const autosave = useAutosave({
    document,
    content,
    generation,
    ...(chapterId ? { chapterId } : {}),
    enabled: !isDocumentLoading && articleStarted,
    onSaved: (next, serverChapterId) => {
      if (!isCurrent() || next.id !== documentId) return;
      // 保存结果更新文档基线，并刷新版本历史和独立章节版本号。
      setDocument((current) => ({
        ...current,
        content: next.content,
        revision: next.revision,
        savedAt: next.savedAt,
        storage: next.storage ?? current.storage ?? "server",
      }));
      queryClient.setQueryData<DocumentEnvelope>(["document", next.id], next);
      // 以本次保存实际使用的服务器章节 id（未注册时回退到正文位置 id）更新目录。
      const savedChapterId = serverChapterId ?? chapterId;
      if (savedChapterId && chapterIndex != null) {
        queryClient.setQueryData<ForumChapterItem[]>(
          chapterQueryKeys.directory(documentId),
          (current = []) => {
            const existing = current.find(
              (chapter) => chapter.id === savedChapterId,
            );
            if (existing) {
              return current.map((chapter) =>
                chapter.id === savedChapterId
                  ? {
                      ...chapter,
                      revision: chapter.revision + 1,
                      savedAt: next.savedAt,
                    }
                  : chapter,
              );
            }
            // 目录缓存尚无此行（如离线兜底保存）：立即补入，接口刷新前也能显示版本。
            const chapterTitle =
              splitDocumentByHeadings(content).chapters[chapterIndex]?.title ??
              "未命名章节";
            return [
              ...current,
              {
                id: savedChapterId,
                title: chapterTitle,
                volumeTitle: "",
                order: chapterIndex,
                documentId: next.id,
                revision: 1,
                savedAt: next.savedAt,
                hidden: false,
              },
            ];
          },
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["revisions", next.id] });
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      void queryClient.invalidateQueries({
        queryKey: chapterQueryKeys.directory(documentId),
      });
    },
  });

  const updateChapter = useCallback(
    (chapterIndex: number, chapter: RichTextNode) => {
      replaceContent(mergeChapter(contentRef.current, chapterIndex, chapter));
    },
    [replaceContent],
  );

  // 保存前对比本地正文与服务器章节目录：
  // 1) 正文中存在、但目录缺失的新章节 → 逐个调用新增章节接口注册；
  // 2) 接口返回的服务器 id 写回本地目录缓存（同步回本地）；
  // 3) 返回活动章节的服务器 id，供本次文档保存使用。
  const prepareChapterForSave = useCallback(
    async (
      snapshot: RichTextNode,
      activeIndex: number,
    ): Promise<string | undefined> => {
      if (!isCurrent()) return undefined;
      const chapters = splitDocumentByHeadings(snapshot).chapters;
      const active = chapters[activeIndex];
      if (!active) return undefined;
      // 目录未同步时取服务器最新清单，避免把已有章节误判为新增。
      let directory = queryClient.getQueryData<ForumChapterItem[]>(
        chapterQueryKeys.directory(documentId),
      );
      if (!directory) {
        try {
          directory = await listForumChapters(documentId);
        } catch {
          return isCurrent() ? active.id : undefined;
        }
        if (!isCurrent()) return undefined;
        queryClient.setQueryData<ForumChapterItem[]>(
          chapterQueryKeys.directory(documentId),
          directory,
        );
      }
      // 只注册缺失的新章节（按 order 与正文章节位置对齐）。
      const missing = chapters
        .map((chapter, order) => ({ chapter, order }))
        .filter(({ order }) => !directory!.some((row) => row.order === order));
      if (missing.length > 0) {
        const created: ForumChapterItem[] = [];
        let createFailed = false;
        for (const { chapter, order } of missing) {
          if (createFailed) break;
          try {
            created.push(
              await createDocumentChapter(documentId, {
                title: chapter.title,
                order,
              }),
            );
            if (!isCurrent()) return undefined;
          } catch {
            if (!isCurrent()) return undefined;
            // 离线或注册失败：不中止保存（文档保存路径会自行降级为本地草稿），
            // 目录同步成功后再保存时历史与版本号即可按服务器 id 归集。
            createFailed = true;
          }
        }
        if (created.length > 0) {
          // 服务器 id 同步回本地目录缓存（按 order 保持稳定顺序）。
          queryClient.setQueryData<ForumChapterItem[]>(
            chapterQueryKeys.directory(documentId),
            (current = []) =>
              [
                ...current.filter(
                  (row) => !created.some((item) => item.id === row.id),
                ),
                ...created,
              ].sort((a, b) => a.order - b.order),
          );
        }
      }
      // 清理目录中已超出正文末尾的残留章节行（如离线时删除的章节），
      // 让目录与本地正文在保存时重新对齐。
      const directoryAfter =
        queryClient.getQueryData<ForumChapterItem[]>(
          chapterQueryKeys.directory(documentId),
        ) ?? [];
      const stale = directoryAfter.filter(
        (row) => row.order >= chapters.length,
      );
      if (stale.length > 0) {
        const removedIds: string[] = [];
        for (const row of stale) {
          try {
            const outcome = await deleteDocumentChapter(documentId, row.id);
            if (!isCurrent()) return undefined;
            if (outcome.deleted) removedIds.push(row.id);
          } catch {
            if (!isCurrent()) return undefined;
            break;
          }
        }
        if (removedIds.length > 0) {
          queryClient.setQueryData<ForumChapterItem[]>(
            chapterQueryKeys.directory(documentId),
            (current = []) =>
              current.filter((row) => !removedIds.includes(row.id)),
          );
        }
      }
      return (
        queryClient
          .getQueryData<
            ForumChapterItem[]
          >(chapterQueryKeys.directory(documentId))
          ?.find((row) => row.order === activeIndex)?.id ?? active.id
      );
    },
    [documentId, isCurrent, queryClient],
  );

  const ensureServerDocument = useCallback((): Promise<
    "created" | "existing" | false
  > => {
    if (!isCurrent()) return Promise.resolve(false);
    if (localOnly || document.storage !== "missing")
      return Promise.resolve("existing");
    if (isDocumentLoading || !articleStarted) return Promise.resolve(false);
    if (creationRef.current) return creationRef.current;
    const snapshot = contentRef.current;
    const savedGeneration = generationRef.current;
    autosave.saveLocal(snapshot, savedGeneration);
    const create = async (): Promise<"created" | "existing" | false> => {
      let saved: DocumentEnvelope;
      let created = true;
      try {
        saved = await saveDocument(documentId, {
          title: document.title,
          schemaVersion: document.schemaVersion,
          baseRevision: 0,
          clientMutationId: createId("create"),
          content: snapshot,
        });
      } catch (error) {
        if (!isCurrent()) return false;
        const conflict = error as { status?: unknown; code?: unknown };
        if (conflict.status !== 409 || conflict.code !== "REVISION_CONFLICT") {
          autosave.saveLocal(contentRef.current, generationRef.current);
          throw error;
        }
        const existing = await getDocument(documentId);
        if (!isCurrent()) return false;
        if (existing.storage !== "server") throw error;
        saved = existing;
        created = false;
      }
      if (!isCurrent()) return false;
      if (saved.storage !== "server") {
        autosave.saveLocal(contentRef.current, generationRef.current);
        return false;
      }
      // 创建请求期间继续编辑时只接纳服务器基线，不能替换新正文或冒领新代次。
      const unchanged = generationRef.current === savedGeneration;
      if (created && unchanged) {
        contentRef.current = saved.content;
        setContent(saved.content);
      }
      setDocument(saved);
      queryClient.setQueryData<DocumentEnvelope>(
        ["document", documentId],
        saved,
      );
      autosave.acceptSaved(
        saved,
        created && unchanged ? saved.content : snapshot,
        savedGeneration,
      );
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      void queryClient.invalidateQueries({
        queryKey: chapterQueryKeys.directory(documentId),
      });
      return created ? "created" : "existing";
    };
    const pending = create()
      .catch((error: unknown) => {
        if (!isCurrent()) return false as const;
        throw error;
      })
      .finally(() => {
        if (isCurrent() && creationRef.current === pending)
          creationRef.current = null;
      });
    creationRef.current = pending;
    return pending;
  }, [
    articleStarted,
    autosave,
    document,
    documentId,
    isCurrent,
    isDocumentLoading,
    localOnly,
    queryClient,
  ]);

  const publishChapter = useCallback(
    async (chapterIndex: number, latestChapter?: RichTextNode) => {
      // 提交快捷键可能早于 React onChange；显式合并编辑器快照后再 flush。
      if (!isCurrent() || isDocumentLoading) return false;
      if (latestChapter) {
        const next = mergeChapter(
          contentRef.current,
          chapterIndex,
          latestChapter,
        );
        if (JSON.stringify(next) !== JSON.stringify(contentRef.current)) {
          replaceContent(next);
        }
      }
      if (!articleStarted) return false;
      if (localOnly) {
        return autosave.saveLocal(contentRef.current, generationRef.current);
      }
      if (document.storage === "missing") {
        return (await ensureServerDocument()) !== false;
      }
      // 1. 注册新增章节并拿到服务器 id（离线时保存路径会自行降级为本地草稿）。
      const serverChapterId = await prepareChapterForSave(
        contentRef.current,
        chapterIndex,
      );
      if (!isCurrent()) return false;
      // 2. 用服务器章节 id 执行最小 steps 保存：新章历史与版本号才能正确归集。
      return autosave.flush(
        contentRef.current,
        generationRef.current,
        serverChapterId,
      );
    },
    [
      articleStarted,
      autosave,
      document,
      ensureServerDocument,
      isCurrent,
      isDocumentLoading,
      localOnly,
      prepareChapterForSave,
      replaceContent,
    ],
  );

  const rollback = useCallback(
    async (revision: number, isOperationCurrent?: () => boolean) => {
      const operation = ++rollbackEpochRef.current;
      // 服务端回滚会创建新 revision；返回内容必须同时替换本地正文和保存基线。
      const next = await restoreRevision(
        document.id,
        revision,
        autosave.revision,
      );
      // 宿主可进一步限定到章节/视图操作；旧结果不能通过查询缓存重新水合当前正文。
      if (
        !isCurrent() ||
        operation !== rollbackEpochRef.current ||
        (isOperationCurrent && !isOperationCurrent())
      )
        return next;
      setDocument(next);
      queryClient.setQueryData<DocumentEnvelope>(["document", next.id], next);
      contentRef.current = next.content;
      generationRef.current += 1;
      setContent(next.content);
      setGeneration(generationRef.current);
      autosave.acceptSaved(next, next.content, generationRef.current);
      return next;
    },
    [autosave, document.id, isCurrent, queryClient],
  );

  return {
    document,
    content,
    contentRef,
    generation,
    isPlaceholderData: isDocumentLoading,
    articleStarted,
    autosave,
    replaceContent,
    createLocalArticle,
    ensureServerDocument,
    updateChapter,
    publishChapter,
    rollback,
  };
}
