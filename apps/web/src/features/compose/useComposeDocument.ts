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
  setAutosaveEnabled: (enabled: boolean) => void;
  replaceContent: (next: RichTextNode) => void;
  createLocalArticle: () => void;
  ensureServerDocument: (
    baseContent: RichTextNode,
  ) => Promise<"created" | "existing" | false>;
  updateChapter: (chapterIndex: number, chapter: RichTextNode) => void;
  publishChapter: (
    chapterIndex: number,
    latestChapter?: RichTextNode,
  ) => Promise<boolean>;
  rollback: (revision: number) => Promise<DocumentEnvelope>;
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
      ? { ...missing, content: { type: "doc", content: [{ type: "paragraph" }] } }
      : missing;
  }, [documentId, localOnly, options.initialTitle]);
  const { data = placeholder, isPlaceholderData: queryIsPlaceholderData } = useQuery({
    queryKey: ["document", documentId],
    queryFn: ({ signal }) => getDocument(documentId, signal),
    placeholderData: placeholder,
    enabled: serverEnabled,
  });
  // state 驱动渲染，ref 让 autosave、发布和长文本桥接始终读取最新正文与代次。
  const [document, setDocument] = useState<DocumentEnvelope>(data);
  const [content, setContent] = useState<RichTextNode>(data.content);
  const [generation, setGeneration] = useState(0);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [articleStarted, setArticleStarted] = useState(
    localOnly || data.storage !== "missing",
  );
  const contentRef = useRef<RichTextNode>(data.content);
  const generationRef = useRef(0);
  const documentIdRef = useRef(documentId);
  // 保存前注册新增章节后同步到的服务器章节 id；保存成功回调用它更新目录缓存。
  const activeChapterServerIdRef = useRef<string | undefined>(undefined);
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
  const isDocumentLoading = serverEnabled && (queryIsPlaceholderData || hydrationPending);

  // 切换文章时先同步切换到该文档自己的空壳/本地草稿，禁止沿用上一文章正文。
  useEffect(() => {
    if (documentIdRef.current === documentId) return;
    documentIdRef.current = documentId;
    const draft = loadLocalDocumentDraft(documentId);
    const nextContent = draft?.content ?? placeholder.content;
    const nextGeneration = draft ? 1 : 0;
    setDocument(placeholder);
    setArticleStarted(localOnly || Boolean(draft));
    contentRef.current = nextContent;
    generationRef.current = nextGeneration;
    setContent(nextContent);
    setGeneration(nextGeneration);
  }, [documentId, localOnly, placeholder]);

  // 占位文档的 revision 只是占位元数据，不能作为服务器版本的新旧依据。
  // 首次真实编辑发生前始终接纳查询结果；编辑后则由 generationRef 阻止迟到响应覆盖正文。
  useEffect(() => {
    if (generationRef.current !== 0) return;
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
  }, [data, document, documentId, localOnly]);

  const replaceContent = useCallback((next: RichTextNode) => {
    contentRef.current = next;
    generationRef.current += 1;
    setContent(next);
    setGeneration(generationRef.current);
  }, []);

  const createLocalArticle = useCallback(() => {
    if (articleStarted) return;
    // 空段落只存在浏览器草稿中，用户点击「保存」后才创建 D1 文档和首个版本。
    const blank: RichTextNode = { type: "doc", content: [{ type: "paragraph" }] };
    setArticleStarted(true);
    replaceContent(blank);
  }, [articleStarted, replaceContent]);

  const autosave = useAutosave({
    document,
    content,
    generation,
    ...(chapterId ? { chapterId } : {}),
    enabled: autosaveEnabled && !isDocumentLoading && articleStarted,
    onSaved: (next) => {
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
      const savedChapterId = activeChapterServerIdRef.current ?? chapterId;
      if (savedChapterId && chapterIndex != null) {
        queryClient.setQueryData<ForumChapterItem[]>(
          ["forum", "chapters", documentId],
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
              splitDocumentByHeadings(content).chapters[chapterIndex]
                ?.title ?? "未命名章节";
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
      void queryClient.invalidateQueries({ queryKey: ["forum", "chapters", documentId] });
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
      const chapters = splitDocumentByHeadings(snapshot).chapters;
      const active = chapters[activeIndex];
      if (!active) return undefined;
      // 目录未同步时取服务器最新清单，避免把已有章节误判为新增。
      let directory =
        queryClient.getQueryData<ForumChapterItem[]>(["forum", "chapters", documentId]);
      if (!directory) {
        directory = await listForumChapters(documentId);
        queryClient.setQueryData<ForumChapterItem[]>(
          ["forum", "chapters", documentId],
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
          } catch {
            // 离线或注册失败：不中止保存（文档保存路径会自行降级为本地草稿），
            // 目录同步成功后再保存时历史与版本号即可按服务器 id 归集。
            createFailed = true;
          }
        }
        if (created.length > 0) {
          // 服务器 id 同步回本地目录缓存（按 order 保持稳定顺序）。
          queryClient.setQueryData<ForumChapterItem[]>(
            ["forum", "chapters", documentId],
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
        queryClient.getQueryData<ForumChapterItem[]>(["forum", "chapters", documentId]) ??
        [];
      const stale = directoryAfter.filter((row) => row.order >= chapters.length);
      if (stale.length > 0) {
        const removedIds: string[] = [];
        for (const row of stale) {
          try {
            const outcome = await deleteDocumentChapter(documentId, row.id);
            if (outcome.deleted) removedIds.push(row.id);
          } catch {
            break;
          }
        }
        if (removedIds.length > 0) {
          queryClient.setQueryData<ForumChapterItem[]>(
            ["forum", "chapters", documentId],
            (current = []) =>
              current.filter((row) => !removedIds.includes(row.id)),
          );
        }
      }
      return (
        queryClient
          .getQueryData<ForumChapterItem[]>(["forum", "chapters", documentId])
          ?.find((row) => row.order === activeIndex)?.id ?? active.id
      );
    },
    [documentId, queryClient],
  );

  const ensureServerDocument = useCallback(
    async (baseContent: RichTextNode) => {
      if (localOnly || document.storage !== "missing") return "existing";
      if (isDocumentLoading || !articleStarted) return false;
      const saved = await saveDocument(documentId, {
        title: document.title,
        schemaVersion: document.schemaVersion,
        baseRevision: 0,
        clientMutationId: createId("create"),
        content: baseContent,
      });
      if (saved.storage !== "server") return false;
      setDocument(saved);
      autosave.acceptSaved(saved, baseContent, generationRef.current);
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      void queryClient.invalidateQueries({
        queryKey: ["forum", "chapters", documentId],
      });
      return "created";
    },
    [
      articleStarted,
      autosave,
      document,
      documentId,
      isDocumentLoading,
      localOnly,
      queryClient,
    ],
  );

  const publishChapter = useCallback(
    async (chapterIndex: number, latestChapter?: RichTextNode) => {
      // 提交快捷键可能早于 React onChange；显式合并编辑器快照后再 flush。
      if (isDocumentLoading) return false;
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
        const saved = await saveDocument(documentId, {
          title: document.title,
          schemaVersion: document.schemaVersion,
          baseRevision: 0,
          clientMutationId: createId("create"),
          content: contentRef.current,
        });
        if (saved.storage !== "server") return false;
        // 服务器会执行正文规范化；用确认后的快照同时更新编辑器与 autosave 基线。
        contentRef.current = saved.content;
        setContent(saved.content);
        autosave.acceptSaved(saved, saved.content, generationRef.current);
        void queryClient.invalidateQueries({ queryKey: ["forum", "chapters", documentId] });
        void queryClient.invalidateQueries({ queryKey: ["documents"] });
        return true;
      }
      // 1. 注册新增章节并拿到服务器 id（离线时保存路径会自行降级为本地草稿）。
      const serverChapterId = await prepareChapterForSave(
        contentRef.current,
        chapterIndex,
      );
      activeChapterServerIdRef.current = serverChapterId;
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
      documentId,
      isDocumentLoading,
      localOnly,
      prepareChapterForSave,
      queryClient,
      replaceContent,
    ],
  );

  const rollback = useCallback(
    async (revision: number) => {
      // 服务端回滚会创建新 revision；返回内容必须同时替换本地正文和保存基线。
      const next = await restoreRevision(
        document.id,
        revision,
        autosave.revision,
      );
      setDocument(next);
      queryClient.setQueryData<DocumentEnvelope>(["document", next.id], next);
      contentRef.current = next.content;
      generationRef.current += 1;
      setContent(next.content);
      setGeneration(generationRef.current);
      return next;
    },
    [autosave.revision, document.id, queryClient],
  );

  return {
    document,
    content,
    contentRef,
    generation,
    isPlaceholderData: isDocumentLoading,
    articleStarted,
    autosave,
    setAutosaveEnabled,
    replaceContent,
    createLocalArticle,
    ensureServerDocument,
    updateChapter,
    publishChapter,
    rollback,
  };
}
