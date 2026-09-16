import { createEntityId } from "@ricetext/contracts";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
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
import {
  ensureChapterIdentity,
  isUsableChapterId,
  mergeChapterRange,
  splitDocumentByHeadings,
} from "../../lib/chapters";
import { chapterQueryKeys } from "../../lib/chapter-query-keys";
import { revisionQueryKeys } from "../../lib/revision-query-keys";
import type { DocumentEnvelope, ForumChapterItem, RichTextNode } from "../../lib/types";
import { useAutosave } from "./useAutosave";
import { resolveChapterDirectoryIdentity } from "./chapter-directory-identity";

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
  /** 按稳定章节 ID 合并一章正文；正文里找不到该身份时不改动任何内容。 */
  updateChapter: (chapterId: string, chapter: RichTextNode) => void;
  publishChapter: (chapterId: string, latestChapter?: RichTextNode) => Promise<boolean>;
  /** 仅回退指定章节；返回值仍是包含最新整篇快照的文档信封。 */
  rollback: (
    chapterId: string,
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
    /**
     * 旧正文兼容：只有正文还没有显式章节身份时才按位置对齐服务器目录。
     * 目录行由服务器拥有，正文标题的身份可能还没来得及写回。
     */
    resolveChapterId?: ((chapterIndex: number) => string | undefined) | undefined;
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
  const { data = placeholder, isPlaceholderData: queryIsPlaceholderData } = useQuery({
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
      (!serverEnabled || (!queryIsPlaceholderData && draft.baseRevision === data.revision))
      ? draft
      : null;
  });
  const [document, setDocument] = useState<DocumentEnvelope>(data);
  const [content, setContent] = useState<RichTextNode>(initialDraft?.content ?? data.content);
  const [generation, setGeneration] = useState(initialDraft ? 1 : 0);
  const [articleStarted, setArticleStarted] = useState(
    localOnly || data.storage !== "missing" || Boolean(initialDraft),
  );
  const contentRef = useRef<RichTextNode>(content);
  const generationRef = useRef(generation);
  const sessionRef = useRef({ documentId });
  const creationRef = useRef<Promise<"created" | "existing" | false> | null>(null);
  const rollbackEpochRef = useRef(0);
  if (sessionRef.current.documentId !== documentId) {
    sessionRef.current = { documentId };
    creationRef.current = null;
    const storedDraft = loadLocalDocumentDraft(documentId);
    const draft =
      storedDraft &&
      (!serverEnabled || (!queryIsPlaceholderData && storedDraft.baseRevision === data.revision))
        ? storedDraft
        : null;
    const nextContent = draft?.content ?? data.content;
    const nextGeneration = draft ? 1 : 0;
    setDocument(data);
    setArticleStarted(localOnly || data.storage !== "missing" || Boolean(draft));
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
  // 章节身份来自正文标题节点（创建时铸造一次，缺身份的由 ensureChapterIdentity
  // 在保存前补铸并写回正文）；位置只用来选中当前编辑的章节。
  // 章节位置（目录顺序）与文档位置（正文块偏移）是两件事：页面的目录可能包含
  // 独立章节正文，映射到文档的索引会偏移。因此身份解析交给宿主按目录位置完成。
  const resolveChapterId = options.resolveChapterId;
  const chapterId = useMemo(() => {
    if (chapterIndex == null || chapterIndex < 0) return undefined;
    const section = splitDocumentByHeadings(content).chapters[chapterIndex];
    // 稳定身份优先：正文标题上的 chapterId 就是身份，不从目录顺序反推。
    if (section?.explicitIdentity && isUsableChapterId(section.id)) return section.id;
    // 旧正文还没补身份时才按服务端目录顺序对齐（唯一的位置兼容点）。
    const fromDirectory = resolveChapterId?.(chapterIndex);
    if (isUsableChapterId(fromDirectory)) return fromDirectory;
    // 正文完全没有分章标题时（单章正文），沿用位置派生 id：
    // 它是 ensureChapterIdentity 补铸之前唯一可用的章节引用。
    return section && isUsableChapterId(section.id) ? section.id : undefined;
  }, [chapterIndex, content, resolveChapterId]);
  // Query 结束到本地 state 水合之间仍视为加载中，避免编辑器在这一帧上报占位正文。
  const hydrationPending = generationRef.current === 0 && data !== document;
  const isDocumentLoading = serverEnabled && (queryIsPlaceholderData || hydrationPending);

  // 占位文档的 revision 只是占位元数据，不能作为服务器版本的新旧依据。
  // 首次真实编辑发生前始终接纳查询结果；编辑后则由 generationRef 阻止迟到响应覆盖正文。
  useEffect(() => {
    if (serverEnabled && queryIsPlaceholderData) return;
    if (generationRef.current !== 0) {
      if (document.storage === "missing" && data.storage === "server") setDocument(data);
      return;
    }
    if (data === document) return;
    setDocument(data);
    const draft = loadLocalDocumentDraft(documentId);
    const restoreDraft = draft?.baseRevision === data.revision;
    if (draft && !restoreDraft) clearLocalDocumentDraft(documentId);
    const nextContent = draft && restoreDraft ? draft.content : data.content;
    const nextGeneration = restoreDraft ? 1 : 0;
    setArticleStarted(localOnly || data.storage !== "missing" || Boolean(restoreDraft));
    contentRef.current = nextContent;
    generationRef.current = nextGeneration;
    setContent(nextContent);
    setGeneration(nextGeneration);
  }, [data, document, documentId, localOnly, queryIsPlaceholderData, serverEnabled]);

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
            const existing = current.find((chapter) => chapter.id === savedChapterId);
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
              splitDocumentByHeadings(content).chapters[chapterIndex]?.title ?? "未命名章节";
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
      void queryClient.invalidateQueries({ queryKey: revisionQueryKeys.article(next.id) });
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      void queryClient.invalidateQueries({
        queryKey: chapterQueryKeys.directory(documentId),
      });
    },
  });

  /**
   * 正文中的活动章节位置。
   *
   * 稳定 chapterId 优先；**整篇正文都还没有显式身份**时（旧正文，含完全没有
   * 分章标题的单章正文）才退回文档位置——位置来自宿主传入的 documentIndex，
   * 这是本 Hook 里唯一的位置兼容点。正文里已有别的显式身份却找不到目标时返回 -1，
   * 调用方必须拒绝写入而不是猜一章。
   */
  const locateActiveChapter = useCallback(
    (snapshot: RichTextNode, activeChapterId: string): number => {
      const chapters = splitDocumentByHeadings(snapshot).chapters;
      const exact = chapters.findIndex(
        (candidate) => candidate.explicitIdentity && candidate.id === activeChapterId,
      );
      if (exact >= 0) return exact;
      if (chapters.some((candidate) => candidate.explicitIdentity)) return -1;
      if (chapterIndex != null && chapterIndex >= 0 && chapterIndex < chapters.length) {
        return chapterIndex;
      }
      return chapters.length === 1 ? 0 : -1;
    },
    [chapterIndex],
  );

  /** 按稳定章节 ID 合并一章正文；正文里找不到该身份时不改动任何内容。 */
  const updateChapter = useCallback(
    (chapterId: string, chapter: RichTextNode) => {
      const current = contentRef.current;
      const sections = splitDocumentByHeadings(current).chapters;
      const index = locateActiveChapter(current, chapterId);
      const section = index >= 0 ? sections[index] : undefined;
      if (!section) return;
      const next = mergeChapterRange(
        current as never,
        { start: section.start, end: section.end },
        chapter as never,
        section.explicitIdentity ? chapterId : undefined,
      );
      if (next) replaceContent(next as unknown as RichTextNode);
    },
    [locateActiveChapter, replaceContent],
  );

  /**
   * 给正文里缺身份的章节标题补一次身份并写回。
   *
   * 目录里已有的章节复用服务器 id（否则会把旧正文的目录行变成孤儿）；
   * 目录里没有的才现铸 `chapter_<uuid>`，由接下来的注册流程登记。
   * 没有缺身份时保持引用不变，不产生多余代次。
   */
  const ensureChapterIdentityInPlace = useCallback(() => {
    // 身份补铸是唯一的旧正文兼容路径：只有缺身份的章节标题才会回调宿主。
    const { content: next, changed } = ensureChapterIdentity(contentRef.current, ({ position }) =>
      options.resolveChapterId?.(position),
    );
    if (changed) replaceContent(next);
  }, [replaceContent, options.resolveChapterId]);

  // 保存前对比本地正文与服务器章节目录：
  // 1) 正文中存在、但目录缺失的新章节 → 逐个调用新增章节接口注册；
  // 2) 接口返回的服务器 id 写回本地目录缓存（同步回本地）；
  // 3) 返回活动章节的服务器 id，供本次文档保存使用。
  const prepareChapterForSave = useCallback(
    async (
      snapshot: RichTextNode,
      activeChapterId: string,
      fallbackActiveIndex?: number,
    ): Promise<string | undefined> => {
      if (!isCurrent()) return undefined;
      const chapters = splitDocumentByHeadings(snapshot).chapters;
      const fallbackIndex =
        fallbackActiveIndex !== undefined && fallbackActiveIndex >= 0 && fallbackActiveIndex < chapters.length
          ? fallbackActiveIndex
          : -1;
      const located = locateActiveChapter(snapshot, activeChapterId);
      // 身份补铸可能把「按位置定位」的旧章节换成现铸 ID：此时沿用补铸前的位置。
      const activeIndex = located >= 0 ? located : fallbackIndex;
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
          return undefined;
        }
        if (!isCurrent()) return undefined;
        queryClient.setQueryData<ForumChapterItem[]>(
          chapterQueryKeys.directory(documentId),
          directory,
        );
      }
      // 只注册目录里无法解析的章节：稳定 ID 优先，旧正文允许唯一 order 兼容。
      const missing = chapters.filter(
        (chapter, index) =>
          isUsableChapterId(chapter.id) &&
          !resolveChapterDirectoryIdentity(directory, chapter, index),
      );
      if (missing.length > 0) {
        const created: ForumChapterItem[] = [];
        let createFailed = false;
        for (const chapter of missing) {
          if (createFailed) break;
          try {
            created.push(
              await createDocumentChapter(documentId, {
                chapterId: chapter.id,
                title: chapter.title,
              }),
            );
            if (!isCurrent()) return undefined;
          } catch {
            if (!isCurrent()) return undefined;
            // 注册失败后停止剩余远端操作；调用方会保留本地草稿，绝不猜测目录身份。
            createFailed = true;
          }
        }
        if (created.length > 0) {
          // 服务器 id 同步回本地目录缓存（按 order 保持稳定顺序）。
          queryClient.setQueryData<ForumChapterItem[]>(
            chapterQueryKeys.directory(documentId),
            (current = []) =>
              [
                ...current.filter((row) => !created.some((item) => item.id === row.id)),
                ...created,
              ].sort((a, b) => a.order - b.order),
          );
        }
      }
      // 清理目录里正文已不存在的残留章节行（如离线时删除的章节）：
      // 按 chapterId 判定，位置不再参与——移动章节不会误删任何一行。
      const directoryAfter =
        queryClient.getQueryData<ForumChapterItem[]>(chapterQueryKeys.directory(documentId)) ?? [];
      const survivingIds = new Set<string>();
      chapters.forEach((chapter, index) => {
        survivingIds.add(chapter.id);
        const resolved = resolveChapterDirectoryIdentity(directoryAfter, chapter, index);
        if (resolved) survivingIds.add(resolved);
      });
      const stale = directoryAfter.filter((row) => !survivingIds.has(row.id));
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
            (current = []) => current.filter((row) => !removedIds.includes(row.id)),
          );
        }
      }
      // 精确 ID 优先；旧正文只允许唯一 order 对齐。无法确认时禁止远端保存。
      const currentDirectory =
        queryClient.getQueryData<ForumChapterItem[]>(chapterQueryKeys.directory(documentId)) ?? [];
      return resolveChapterDirectoryIdentity(currentDirectory, active, activeIndex);
    },
    [documentId, isCurrent, queryClient],
  );

  const ensureServerDocument = useCallback((): Promise<"created" | "existing" | false> => {
    if (!isCurrent()) return Promise.resolve(false);
    if (localOnly || document.storage !== "missing") return Promise.resolve("existing");
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
          clientMutationId: createEntityId("mutation"),
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
      queryClient.setQueryData<DocumentEnvelope>(["document", documentId], saved);
      autosave.acceptSaved(saved, created && unchanged ? saved.content : snapshot, savedGeneration);
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
        if (isCurrent() && creationRef.current === pending) creationRef.current = null;
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
    async (chapterId: string, latestChapter?: RichTextNode) => {
      // 提交快捷键可能早于 React onChange；显式合并编辑器快照后再 flush。
      if (!isCurrent() || isDocumentLoading) return false;
      if (latestChapter) {
        const current = contentRef.current;
        // 提交快捷键可能早于 React onChange：先按稳定 ID 定位这一章再合并快照。
        const index = locateActiveChapter(current, chapterId);
        const section = index >= 0 ? splitDocumentByHeadings(current).chapters[index] : undefined;
        const next = section
          ? mergeChapterRange(
              current as never,
              { start: section.start, end: section.end },
              latestChapter as never,
              section.explicitIdentity ? chapterId : undefined,
            )
          : null;
        if (next && JSON.stringify(next) !== JSON.stringify(contentRef.current)) {
          replaceContent(next as unknown as RichTextNode);
        }
      }
      if (!articleStarted) return false;
      // 0. 缺身份的章节标题先补铸并写回正文：一次写入换来永久稳定的章节身份。
      //    补铸会把旧正文的位置 ID 换成持久身份，因此先记下补铸前的位置：
      //    补铸后按新身份找不到目标章节时，用这个位置继续，而不是拒绝保存。
      const fallbackActiveIndex = locateActiveChapter(contentRef.current, chapterId);
      ensureChapterIdentityInPlace();
      if (localOnly) {
        return autosave.saveLocal(contentRef.current, generationRef.current);
      }
      if (document.storage === "missing") {
        return (await ensureServerDocument()) !== false;
      }
      // 1. 注册新增章节（身份由正文节点提供；离线时保存路径会自行降级为本地草稿）。
      //    身份在调用时从目录重新解析：渲染闭包里的值可能早于目录到达。
      const serverChapterId = await prepareChapterForSave(
        contentRef.current,
        chapterId,
        fallbackActiveIndex,
      );
      if (!isCurrent()) return false;
      if (!serverChapterId) {
        autosave.saveLocal(contentRef.current, generationRef.current);
        return false;
      }
      // 2. 用已确认的服务器章节身份执行最小 steps 保存。
      return autosave.flush(contentRef.current, generationRef.current, serverChapterId);
    },
    [
      articleStarted,
      autosave,
      document,
      ensureServerDocument,
      isCurrent,
      isDocumentLoading,
      localOnly,
      locateActiveChapter,
      prepareChapterForSave,
      replaceContent,
    ],
  );

  const rollback = useCallback(
    async (chapterId: string, revision: number, isOperationCurrent?: () => boolean) => {
      const operation = ++rollbackEpochRef.current;
      // 服务端回滚会创建新 revision；返回内容必须同时替换本地正文和保存基线。
      const next = await restoreRevision(document.id, chapterId, revision, autosave.revision);
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
      queryClient.setQueryData<ForumChapterItem[]>(
        chapterQueryKeys.directory(document.id),
        (current = []) =>
          current.map((chapter) =>
            chapter.id === chapterId
              ? { ...chapter, revision: chapter.revision + 1, savedAt: next.savedAt }
              : chapter,
          ),
      );
      void queryClient.invalidateQueries({
        queryKey: revisionQueryKeys.chapter(document.id, chapterId),
      });
      void queryClient.invalidateQueries({ queryKey: chapterQueryKeys.directory(document.id) });
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
