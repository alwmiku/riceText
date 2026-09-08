import type { Editor } from "@tiptap/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BookOpen,
  Check,
  MessageCircle,
  Monitor,
  Smartphone,
  X,
} from "lucide-react";
import { useMemo, useRef, useState, useEffect } from "react";
import { useAppContext } from "../app-context";
import { Button, Dialog, Segmented } from "../components/ui";
import { CommentThread } from "../features/comments/CommentThread";
import { ArticleSelector } from "../features/documents/ArticleSelector";
import { useArticleSelection } from "../features/documents/useArticleSelection";
import { LongTextWorkspace } from "../features/compose/LongTextWorkspace";
import { SaveStatus } from "../features/compose/SaveStatus";
import { StandardComposeWorkspace } from "../features/compose/StandardComposeWorkspace";
import { useChapterUpload } from "../features/compose/useChapterUpload";
import { useComposeDocument } from "../features/compose/useComposeDocument";
import { useLongTextWorkspace } from "../features/compose/useLongTextWorkspace";
import { RevisionComparison } from "../features/comparison/RevisionComparison";
import { EditorErrorBoundary } from "../features/editor/errors/EditorErrorBoundary";
import { RichTextEditor } from "../features/editor/RichTextEditor";
import {
  deleteDocumentChapter,
  getCommentThread,
  getLongTextChapter,
  listForumChapters,
  setDocumentChapterHidden,
  uploadLongTextChapter,
} from "../lib/api";
import { getRevision } from "../lib/api/revisions";
import {
  appendChapter,
  chapterTextLines,
  removeChapter,
  splitDocumentByChapters as splitDocumentByHeadings,
} from "@ricetext/document-core";
import type {
  CommentReply,
  DocumentEnvelope,
  EditorMode,
  ForumChapterItem,
  RichTextNode,
  SeedIdentity,
} from "../lib/types";
import { cn, sha256Hex } from "../lib/utils";
import { chapterQueryKeys } from "../lib/chapter-query-keys";
import {
  resolveChapterContent,
  resolveChapterSources,
  isBlankDocumentShell,
  type ChapterIdentity,
} from "../lib/chapter-source";
import { Skeleton } from "../components/ui/skeleton";

const CHINESE_NUMERALS = [
  "零",
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
] as const;

/** 把章节序号转成中文数字（1→一，11→十一，23→二十三），与种子章节命名一致。 */
function toChineseNumber(value: number): string {
  if (value < 10) return CHINESE_NUMERALS[value] ?? String(value);
  if (value < 20) return `十${value > 10 ? CHINESE_NUMERALS[value % 10] : ""}`;
  const tens = Math.floor(value / 10);
  const units = value % 10;
  if (tens > 9 || units === 0) return String(value);
  return `${CHINESE_NUMERALS[tens]}十${CHINESE_NUMERALS[units]}`;
}

/** 创作页编排层：组合文档、长文本、上传和展示控制器，不承载各领域内部状态机。 */
export default function ComposePage() {
  const { identity } = useAppContext();
  const articleSelection = useArticleSelection();
  const activeDocumentId = articleSelection.authenticated
    ? articleSelection.selectedId || `article-${identity.id}`
    : "guest-local";
  return (
    <ComposeDocumentSession
      key={JSON.stringify([identity.id, activeDocumentId])}
      identity={identity}
      articleSelection={articleSelection}
      activeDocumentId={activeDocumentId}
    />
  );
}

function ComposeDocumentSession({
  identity,
  articleSelection,
  activeDocumentId,
}: {
  identity: SeedIdentity;
  articleSelection: ReturnType<typeof useArticleSelection>;
  activeDocumentId: string;
}) {
  const selectedArticle = articleSelection.articles.find(
    (article) => article.id === activeDocumentId,
  );
  const canEditSelected = articleSelection.authenticated
    ? (selectedArticle?.canEdit ?? articleSelection.canCreate)
    : true;
  const [mode, setMode] = useState<EditorMode>(() =>
    window.matchMedia("(max-width: 600px)").matches ? "mobile" : "full",
  );
  // 记住上次编辑的章节：刷新/重进页面后仍停留在原章节（移动端尤其依赖）。
  // 稳定章节 ID 优先；原索引键仅作为旧草稿的兼容回退。
  const ACTIVE_CHAPTER_STORAGE_KEY = `ricetext:active-chapter:${activeDocumentId}`;
  const [chapterIndex, setChapterIndex] = useState<number>(() => {
    try {
      const stored = Number.parseInt(
        window.localStorage.getItem(ACTIVE_CHAPTER_STORAGE_KEY) ?? "",
        10,
      );
      return Number.isFinite(stored) && stored >= 0 ? stored : 0;
    } catch {
      return 0;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(
        ACTIVE_CHAPTER_STORAGE_KEY,
        String(chapterIndex),
      );
    } catch {
      // 隐私模式等场景下忽略持久化失败。
    }
  }, [chapterIndex, ACTIVE_CHAPTER_STORAGE_KEY]);
  const [selectedChapter, setSelectedChapter] =
    useState<ChapterIdentity | null>(() => {
      try {
        const id = window.localStorage.getItem(
          `ricetext:active-chapter-id:${activeDocumentId}`,
        );
        return id ? { documentId: activeDocumentId, id } : null;
      } catch {
        return null;
      }
    });
  useEffect(() => {
    if (!selectedChapter) return;
    try {
      window.localStorage.setItem(
        `ricetext:active-chapter-id:${activeDocumentId}`,
        selectedChapter.id,
      );
    } catch {
      // 存储不可用时，仍使用旧版位置作为回退。
    }
  }, [activeDocumentId, selectedChapter]);
  const [documentIndex, setDocumentIndex] = useState(chapterIndex);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [newArticleDialogOpen, setNewArticleDialogOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [comparingRevision, setComparingRevision] = useState<number | null>(
    null,
  );
  const [comparison, setComparison] = useState<{
    revision: number;
    chapterTitle: string;
    historicalContent: RichTextNode;
    currentContent: RichTextNode;
  } | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const articleSwitchRef = useRef(false);
  const [switchingArticle, setSwitchingArticle] = useState(false);

  const directoryQuery = useQuery({
    queryKey: chapterQueryKeys.directory(activeDocumentId),
    queryFn: () => listForumChapters(activeDocumentId, { strict: true }),
    enabled: articleSelection.authenticated && !articleSelection.loading,
  });
  // 三个控制器通过完整文档快照衔接；页面只负责跨领域编排和提示展示。
  const chapterDirectory = directoryQuery.data ?? [];
  const compose = useComposeDocument(activeDocumentId, documentIndex, {
    serverEnabled: articleSelection.authenticated && !articleSelection.loading,
    localOnly: !articleSelection.authenticated,
    initialTitle: articleSelection.selectedDraftTitle,
  });
  const longText = useLongTextWorkspace({
    documentId: activeDocumentId,
    setNotice,
  });
  const upload = useChapterUpload({
    novelId: activeDocumentId,
    captureSnapshot: longText.captureUploadSnapshot,
    ensureDocument: compose.ensureServerDocument,
    onNotice: setNotice,
  });

  const { chapters } = useMemo(
    () => splitDocumentByHeadings(compose.content),
    [compose.content],
  );
  const directoryReady =
    !articleSelection.authenticated || directoryQuery.isSuccess;
  const navigationChapters = useMemo(
    () =>
      directoryReady
        ? resolveChapterSources({
            documentId: activeDocumentId,
            content: compose.content,
            directory: chapterDirectory,
            includeHidden: true,
            preferDocumentContent: true,
            includeUnlistedDocumentChapters: true,
          })
        : [],
    [activeDocumentId, compose.content, chapterDirectory, directoryReady],
  );
  const displayedChapters = compose.articleStarted ? navigationChapters : [];
  const selectedIndex =
    selectedChapter?.documentId === activeDocumentId
      ? navigationChapters.findIndex(
          (chapter) => chapter.id === selectedChapter.id,
        )
      : -1;
  const activeIndex =
    selectedIndex >= 0
      ? selectedIndex
      : Math.min(chapterIndex, Math.max(0, navigationChapters.length - 1));
  const activeChapter = navigationChapters[activeIndex];
  // 空白本地编辑器会成为第一个旧版章节，同时保持编辑会话不变。
  const activeChapterId = activeChapter?.id ?? "chapter-0";
  const activeChapterSource = activeChapter?.source ?? "document";
  if (activeChapter && selectedChapter?.id !== activeChapter.id) {
    setSelectedChapter({ documentId: activeDocumentId, id: activeChapter.id });
  }
  const activeChapterStatus = activeChapter?.directory;
  const usesUploadedChapters = activeChapter?.source === "standalone";
  const mappedDocumentIndex = activeChapter?.documentChapter
    ? chapters.findIndex(
        (chapter) =>
          chapter.start === activeChapter.documentChapter!.start &&
          chapter.end === activeChapter.documentChapter!.end,
      )
    : activeChapter
      ? -1
      : 0;
  if (documentIndex !== mappedDocumentIndex)
    setDocumentIndex(mappedDocumentIndex);
  const uploadedChapterKey = chapterQueryKeys.content(
    activeDocumentId,
    activeChapter?.id,
  );
  const chapterQuery = useQuery({
    queryKey: uploadedChapterKey,
    queryFn: ({ signal }) =>
      getLongTextChapter(activeDocumentId, activeChapter!.id, signal),
    enabled: articleSelection.authenticated && usesUploadedChapters,
  });
  const uploadedChapter = chapterQuery.data;
  const resolvedContent = useMemo(
    () =>
      resolveChapterContent(activeChapter, {
        data: uploadedChapter,
        isError: chapterQuery.isError,
      }),
    [activeChapter, uploadedChapter, chapterQuery.isError],
  );
  const directoryLoading =
    articleSelection.authenticated && directoryQuery.isPending;
  const sourceError =
    directoryQuery.isError || resolvedContent.source === "error";
  const sourceLoading =
    directoryLoading || resolvedContent.source === "loading";
  const contentReady =
    !sourceError &&
    !sourceLoading &&
    (resolvedContent.source === "document" ||
      resolvedContent.source === "standalone" ||
      !activeChapter);
  const unsupportedDocumentRange =
    activeChapter?.source === "document" && mappedDocumentIndex < 0;
  const canWriteChapter =
    !compose.isPlaceholderData &&
    compose.articleStarted &&
    canEditSelected &&
    contentReady &&
    !unsupportedDocumentRange;
  const editorContent = useMemo<RichTextNode>(
    () =>
      resolvedContent.content ?? {
        type: "doc",
        content: activeChapter ? [] : (chapters[0]?.blocks ?? []),
      },
    [resolvedContent.content, activeChapter, chapters],
  );
  const activeCharCount = useMemo(
    () =>
      chapterTextLines(editorContent.content ?? [])
        .join("")
        .replace(/\s+/gu, "").length,
    [editorContent],
  );
  const activeRevision =
    uploadedChapter?.id === activeChapter?.id && usesUploadedChapters
      ? (uploadedChapter?.revision ?? activeChapterStatus?.revision ?? 0)
      : (activeChapterStatus?.revision ?? 0);
  const activeSavedAt =
    compose.autosave.state === "saved"
      ? (activeChapterStatus?.savedAt ?? compose.document.savedAt)
      : compose.autosave.savedAt;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const viewKey = JSON.stringify([
    activeDocumentId,
    activeChapterId,
    activeChapterSource,
    longText.enabled,
    longText.enabled ? longText.activeIndex : null,
  ]);
  const viewScopeRef = useRef({ key: viewKey });
  if (viewScopeRef.current.key !== viewKey)
    viewScopeRef.current = { key: viewKey };
  const viewScope = viewScopeRef.current;
  const isCurrentView = () =>
    mountedRef.current && viewScopeRef.current === viewScope;
  const compareRequestRef = useRef(0);
  const rollbackRequestRef = useRef(0);
  const resetView = () => {
    viewScopeRef.current = { key: viewKey };
    editorRef.current = null;
    setNotice("");
    setComparison(null);
    setComparingRevision(null);
    setThreadId(null);
  };
  const selectChapter = (index: number) => {
    resetView();
    setChapterIndex(index);
    const chapter = navigationChapters[index];
    setSelectedChapter(
      chapter ? { documentId: activeDocumentId, id: chapter.id } : null,
    );
  };
  const { data: comments = [] } = useQuery<CommentReply[]>({
    queryKey: ["comments", compose.document.id, threadId],
    queryFn: () => getCommentThread(compose.document.id, threadId!),
    enabled: Boolean(threadId),
  });

  const compareRevision = async (revision: number) => {
    if (!contentReady) return;
    const request = ++compareRequestRef.current;
    const currentContent = structuredClone(
      editorRef.current?.getJSON() ?? editorContent,
    );
    setComparingRevision(revision);
    try {
      const snapshot = await getRevision(activeDocumentId, revision);
      if (!isCurrentView() || request !== compareRequestRef.current) return;
      const historical = resolveChapterSources({
        documentId: activeDocumentId,
        content: snapshot.content,
        directory: chapterDirectory,
        includeHidden: true,
        preferDocumentContent: true,
        includeUnlistedDocumentChapters: true,
      }).find((chapter) => chapter.id === activeChapter?.id);
      const historicalContent = resolveChapterContent(historical);
      if (historicalContent.source !== "document") {
        setNotice("该历史版本没有当前章节正文");
        return;
      }
      setComparison({
        revision,
        chapterTitle: activeChapter?.title ?? compose.document.title,
        historicalContent: historicalContent.content,
        currentContent,
      });
    } catch (cause) {
      if (isCurrentView() && request === compareRequestRef.current) {
        setNotice(cause instanceof Error ? cause.message : "版本比较加载失败");
      }
    } finally {
      if (isCurrentView() && request === compareRequestRef.current)
        setComparingRevision(null);
    }
  };

  const rollback = async (revision: number) => {
    if (!canWriteChapter) return;
    const request = ++rollbackRequestRef.current;
    const operationIsCurrent = () =>
      isCurrentView() && rollbackRequestRef.current === request;
    compareRequestRef.current += 1;
    setComparingRevision(null);
    setComparison(null);
    try {
      const next = await compose.rollback(revision, operationIsCurrent);
      if (!operationIsCurrent()) return;
      setNotice("已回退到版本 " + revision + "，并创建版本 " + next.revision);
    } catch (error) {
      if (operationIsCurrent())
        setNotice(error instanceof Error ? error.message : "版本回退失败");
    }
  };

  const toggleChapterHidden = async (index: number, hidden: boolean) => {
    const chapter = navigationChapters[index];
    const row = chapter?.directory;
    if (!canEditSelected) return;
    if (!row) {
      setNotice("该章节尚未注册到服务器（保存后才会创建），暂时无法设置隐藏");
      return;
    }
    try {
      await setDocumentChapterHidden(activeDocumentId, row.id, hidden);
      void queryClient.invalidateQueries({
        queryKey: chapterQueryKeys.directory(activeDocumentId),
      });
      if (!isCurrentView()) return;
      setNotice(
        hidden
          ? "已隐藏「" + chapter.title + "」，读者在取消隐藏前不可见"
          : "「" + chapter.title + "」已恢复可读",
      );
    } catch (cause) {
      if (!isCurrentView()) return;
      setNotice(
        cause instanceof Error
          ? "设置章节可见性失败：" + cause.message
          : "设置章节可见性失败",
      );
    }
  };

  // 校订章节：与阅读页「开始校订」一致（字级 diff 校订视图）。
  const proofreadChapter = (index: number) => {
    const chapter = navigationChapters[index];
    if (chapter)
      navigate(
        `/read?chapter=${index}&chapterId=${encodeURIComponent(chapter.id)}&proofread=1`,
      );
  };

  // 空库先建立纯本地空白文章；只有之后点击保存才会创建服务器首版。
  const createArticle = () => setNewArticleDialogOpen(true);

  useEffect(() => {
    if (
      articleSelection.loading ||
      selectedArticle ||
      !articleSelection.selectedDraftTitle ||
      compose.articleStarted
    )
      return;
    compose.createLocalArticle();
    setChapterIndex(0);
    setNotice(
      `已在本地创建《${articleSelection.selectedDraftTitle}》，点击保存后上传服务器`,
    );
  }, [
    articleSelection.loading,
    articleSelection.selectedDraftTitle,
    compose.articleStarted,
    selectedArticle,
    compose.createLocalArticle,
  ]);

  // 在文档末尾追加一个空章节并切换到它；保存时随整篇正文一起入库。
  const addChapter = () => {
    if (
      !canEditSelected ||
      compose.isPlaceholderData ||
      directoryLoading ||
      directoryQuery.isError
    ) {
      setNotice("章节目录尚未就绪，请加载后再新增");
      return;
    }
    const current = compose.contentRef.current;
    if (chapterDirectory.length > 0 && isBlankDocumentShell(current)) {
      setNotice("请在长文本工作台新增并上传章节");
      return;
    }
    const number = splitDocumentByHeadings(current).chapters.length + 1;
    const result = appendChapter(
      current,
      `第${toChineseNumber(number)}章 新章节`,
    );
    compose.replaceContent(result.document);
    resetView();
    setSelectedChapter(null);
    setChapterIndex(result.index);
    setNotice(`已新增第 ${number} 章，保存后目录与版本号会同步更新`);
  };

  const deleteChapter = async (index: number) => {
    const chapter = navigationChapters[index];
    if (!chapter || !canEditSelected || compose.isPlaceholderData) return;
    if (chapter.source !== "document") {
      const row = chapter.directory;
      if (!row) return;
      try {
        const outcome = await deleteDocumentChapter(activeDocumentId, row.id);
        void queryClient.invalidateQueries({
          queryKey: chapterQueryKeys.directory(activeDocumentId),
        });
        queryClient.removeQueries({
          queryKey: chapterQueryKeys.content(activeDocumentId, row.id),
          exact: true,
        });
        if (!isCurrentView()) return;
        resetView();
        queryClient.setQueryData<ForumChapterItem[]>(
          chapterQueryKeys.directory(activeDocumentId),
          (current = []) => current.filter((item) => item.id !== row.id),
        );
        setSelectedChapter(null);
        setChapterIndex(
          Math.min(index, Math.max(0, navigationChapters.length - 2)),
        );
        setNotice(
          outcome.deleted
            ? "已从服务器删除章节「" + row.title + "」"
            : "该服务器章节已经不存在，目录即将刷新",
        );
      } catch (error) {
        if (isCurrentView())
          setNotice(
            error instanceof Error ? error.message : "服务器章节删除失败",
          );
      }
      return;
    }
    const position = chapters.findIndex(
      (candidate) =>
        candidate.start === chapter.documentChapter?.start &&
        candidate.end === chapter.documentChapter?.end,
    );
    if (position < 0) {
      setNotice("请在长文本工作台编辑此章节");
      return;
    }
    const result = removeChapter(compose.contentRef.current, position);
    if (!result.removed) return;
    resetView();
    compose.replaceContent(result.document);
    queryClient.setQueryData<ForumChapterItem[]>(
      chapterQueryKeys.directory(activeDocumentId),
      (current = []) =>
        current
          .filter((row) => row.id !== chapter.id)
          .map((row) =>
            row.order > position ? { ...row, order: row.order - 1 } : row,
          ),
    );
    setSelectedChapter(null);
    setChapterIndex(
      Math.min(index, Math.max(0, navigationChapters.length - 2)),
    );
    setNotice(
      "已删除章节「" + result.removed.title + "」（仅本地草稿，点保存后生效）",
    );
    try {
      const outcome = await deleteDocumentChapter(activeDocumentId, chapter.id);
      if (outcome.deleted) {
        void queryClient.invalidateQueries({
          queryKey: chapterQueryKeys.directory(activeDocumentId),
        });
      }
    } catch {
      if (isCurrentView()) {
        setNotice(
          "已从本地草稿删除「" +
            result.removed.title +
            "」，服务器目录将在下次保存时重新对账",
        );
      }
    }
  };

  const publishingRef = useRef<object | null>(null);
  const [publishingScope, setPublishingScope] = useState<object | null>(null);
  const publish = async (latestContent?: RichTextNode) => {
    if (!isCurrentView()) return;
    if (longText.enabled) {
      await longText.saveDraft();
      return;
    }
    if (!canWriteChapter || publishingRef.current === viewScope) return;
    publishingRef.current = viewScope;
    setPublishingScope(viewScope);
    try {
      if (usesUploadedChapters && activeChapterStatus && uploadedChapter) {
        const snapshot =
          latestContent ?? editorRef.current?.getJSON() ?? editorContent;
        const hash = await sha256Hex(
          JSON.stringify({
            title: activeChapterStatus.title,
            order: activeChapterStatus.order,
            content: snapshot,
          }),
        );
        if (!isCurrentView()) return;
        const saved = await uploadLongTextChapter(
          activeDocumentId,
          activeChapterStatus.id,
          {
            title: activeChapterStatus.title,
            order: activeChapterStatus.order,
            content: snapshot,
            hash,
            baseRevision: uploadedChapter.revision,
          },
        );
        void queryClient.invalidateQueries({
          queryKey: chapterQueryKeys.directory(activeDocumentId),
        });
        if (!isCurrentView()) return;
        queryClient.setQueryData(
          uploadedChapterKey,
          (current: typeof uploadedChapter | undefined) =>
            current
              ? {
                  ...current,
                  content:
                    current.content === uploadedChapter.content
                      ? snapshot
                      : current.content,
                  revision: saved.revision,
                }
              : current,
        );
        setNotice("章节已保存为版本 " + saved.revision);
        return;
      }
      if (mappedDocumentIndex < 0) return;
      const snapshot = latestContent ?? editorRef.current?.getJSON();
      const documentKey = ["document", activeDocumentId] as const;
      const latestBefore =
        queryClient.getQueryData<DocumentEnvelope>(documentKey)?.revision ??
        compose.autosave.revision;
      const saved = await compose.publishChapter(mappedDocumentIndex, snapshot);
      if (!isCurrentView() || !saved) return;
      const latestAfter =
        queryClient.getQueryData<DocumentEnvelope>(documentKey)?.revision;
      setNotice(
        latestAfter === undefined || latestAfter === latestBefore
          ? "内容没有变化，未创建新版本；该章的版本号与历史在首次实际保存时生成"
          : mode === "compact"
            ? "回复已进入发布队列"
            : "正文已保存，可切换到阅读视图检查",
      );
    } catch (cause) {
      if (!isCurrentView()) return;
      setNotice(
        cause instanceof Error
          ? "保存失败：" + cause.message
          : "保存失败，请稍后重试",
      );
    } finally {
      if (publishingRef.current === viewScope) {
        publishingRef.current = null;
        if (isCurrentView()) setPublishingScope(null);
      }
    }
  };

  const editor = (
    <>
      {!longText.enabled && sourceError ? (
        <p role="alert">
          章节加载失败，请重试。{" "}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (directoryQuery.isError) void directoryQuery.refetch();
              else void chapterQuery.refetch();
            }}
          >
            重试
          </Button>
        </p>
      ) : !longText.enabled && sourceLoading ? (
        <Skeleton
          className="h-16 w-full"
          role="status"
          aria-label="正在加载章节正文"
        />
      ) : !longText.enabled && unsupportedDocumentRange ? (
        <p role="status">请在长文本工作台编辑此章节</p>
      ) : !longText.enabled && activeChapter?.source === "placeholder" ? (
        <p role="status">本章暂无正文。</p>
      ) : null}
      <RichTextEditor
        key={
          longText.enabled
            ? `long-text-${activeDocumentId}-${longText.documentVersion}`
            : JSON.stringify([activeDocumentId, activeChapterId])
        }
        content={longText.enabled ? longText.editorContent : editorContent}
        mode={mode}
        editable={
          longText.enabled
            ? !compose.isPlaceholderData &&
              compose.articleStarted &&
              canEditSelected
            : canWriteChapter
        }
        longTextMode={longText.enabled}
        onChange={(next) => {
          if (!isCurrentView() || compose.isPlaceholderData || !canEditSelected)
            return;
          if (!longText.enabled && !canWriteChapter) return;
          if (longText.enabled) longText.updateEditor(next);
          else if (usesUploadedChapters && activeChapterStatus) {
            queryClient.setQueryData(
              uploadedChapterKey,
              (current: typeof uploadedChapter) =>
                current ? { ...current, content: next } : current,
            );
          } else if (mappedDocumentIndex >= 0)
            compose.updateChapter(mappedDocumentIndex, next);
        }}
        onSplitChapter={longText.splitChapter}
        onChapterEdit={longText.editChapter}
        onSubmit={(latestContent) => void publish(latestContent)}
        savedAt={compose.autosave.savedAt}
        onReady={(editorInstance) => {
          if (isCurrentView()) editorRef.current = editorInstance;
        }}
        onExpand={() => setMode("full")}
        onModeToolsOpen={() => setMode("full")}
        onCommentAnchorOpen={setThreadId}
      />
    </>
  );

  const comparisonView = comparison ? (
    <RevisionComparison
      historicalRevision={comparison.revision}
      chapterTitle={comparison.chapterTitle}
      historicalContent={comparison.historicalContent}
      currentContent={comparison.currentContent}
      onExit={() => setComparison(null)}
    />
  ) : undefined;

  const saveStatus = (
    <SaveStatus
      state={compose.isPlaceholderData ? "loading" : compose.autosave.state}
      revision={compose.autosave.revision}
      savedAt={compose.autosave.savedAt}
    />
  );

  return (
    <main className="mx-auto max-w-[1600px] px-5 pt-[18px] pb-[42px] max-[840px]:px-2.5 max-[840px]:pt-3 max-[840px]:pb-7 max-[430px]:px-0 max-[430px]:pt-2 max-[430px]:pb-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
        <div>
          <h1 className="text-base font-bold">发帖与创作工作台</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {mode === "compact"
              ? "快速回复"
              : mode === "mobile"
                ? "移动编辑"
                : "完整创作"}{" "}
            · {identity.name}
          </p>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
          {articleSelection.authenticated ? (
            <ArticleSelector
              articles={articleSelection.articles}
              value={activeDocumentId}
              canCreate={articleSelection.canCreate}
              disabled={
                switchingArticle || upload.preparing || upload.uploading
              }
              open={newArticleDialogOpen}
              onOpenChange={setNewArticleDialogOpen}
              onChange={async (id) => {
                if (articleSwitchRef.current) return;
                articleSwitchRef.current = true;
                setSwitchingArticle(true);
                try {
                  if (longText.enabled && !(await longText.close())) return;
                  if (!mountedRef.current) return;
                  resetView();
                  upload.cancel();
                  articleSelection.setSelectedId(id);
                  const stored = Number.parseInt(
                    window.localStorage.getItem(
                      `ricetext:active-chapter:${id}`,
                    ) ?? "",
                    10,
                  );
                  setChapterIndex(
                    Number.isFinite(stored) && stored >= 0 ? stored : 0,
                  );
                } finally {
                  articleSwitchRef.current = false;
                  setSwitchingArticle(false);
                }
              }}
              onCreate={async (title) => {
                if (articleSwitchRef.current) return;
                articleSwitchRef.current = true;
                setSwitchingArticle(true);
                try {
                  if (longText.enabled && !(await longText.close())) return;
                  if (!mountedRef.current) return;
                  resetView();
                  upload.cancel();
                  articleSelection.createArticle(title);
                  setChapterIndex(0);
                } finally {
                  articleSwitchRef.current = false;
                  setSwitchingArticle(false);
                }
              }}
            />
          ) : null}
          <Button
            size="sm"
            disabled={!compose.articleStarted || !canEditSelected}
            variant={longText.enabled ? "secondary" : "outline"}
            aria-pressed={longText.enabled}
            onClick={() => {
              if (longText.enabled) void longText.close();
              else void longText.open();
            }}
          >
            <BookOpen size={14} />
            长文本
          </Button>
          {!longText.enabled ? (
            <Segmented
              value={mode}
              onChange={setMode}
              ariaLabel="编辑器布局"
              options={[
                {
                  value: "compact",
                  label: "极简",
                  icon: <MessageCircle size={14} />,
                },
                { value: "full", label: "完整", icon: <Monitor size={14} /> },
                {
                  value: "mobile",
                  label: "移动",
                  icon: <Smartphone size={14} />,
                },
              ]}
            />
          ) : null}
        </div>
      </div>

      {compose.autosave.state === "conflict" ||
      (compose.autosave.state === "error" &&
        compose.autosave.conflictMessage) ? (
        <div
          className={cn(
            "mb-3 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-xs",
            compose.autosave.state === "conflict"
              ? "border-[#e5b75e] bg-[#fff9eb] text-[#72500f]"
              : "border-[#f0b4b0] bg-[#fdf1f0] text-[#8f2b24]",
          )}
        >
          <AlertTriangle size={16} />
          <span className="min-w-[220px] flex-1">
            {compose.autosave.conflictMessage}
          </span>
          {compose.autosave.state === "error" ? (
            <span className="whitespace-nowrap">
              当前身份：{identity.name}（仅作者或版主可保存，请切换身份后重试）
            </span>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  navigator.clipboard.writeText(
                    JSON.stringify(compose.content, null, 2),
                  )
                }
              >
                复制本地副本
              </Button>
              <Button size="sm" onClick={() => window.location.reload()}>
                加载最新版
              </Button>
            </>
          )}
        </div>
      ) : null}

      {notice ? (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-[#add4cb] bg-[#edf8f5] px-3 py-2 text-xs text-[#185f57]">
          <Check size={15} />
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice("")}
            aria-label="关闭提示"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {longText.enabled ? (
        <LongTextWorkspace
          saveStatus={saveStatus}
          chapters={longText.chapterSummaries}
          coverageChapters={longText.coverageChapters}
          activeIndex={longText.activeIndex}
          rawText={longText.rawText}
          editor={<EditorErrorBoundary>{editor}</EditorErrorBoundary>}
          chapterTitleStyle={longText.chapterTitleStyle}
          hasLocalDraft={longText.hasLocalDraft}
          hasStoredDraft={longText.hasStoredDraft}
          isPlaceholderData={compose.isPlaceholderData}
          uploadOpen={upload.open}
          uploadDiff={upload.diff}
          preparingUpload={upload.preparing}
          uploading={upload.uploading}
          hasUploadCheckpoint={upload.hasCheckpoint}
          onChapterTitleStyleChange={longText.setChapterTitleStyle}
          onImportFile={longText.importFile}
          onRestoreDraft={longText.restoreDraft}
          onClearDraft={longText.clearDraft}
          onPrepareUpload={upload.prepare}
          onResumeUpload={upload.resume}
          onCancelUpload={upload.cancel}
          onConfirmUpload={upload.confirm}
          onExit={longText.close}
          onAddChapter={longText.addChapter}
          onSelect={longText.selectChapter}
          onDelete={longText.deleteChapter}
          onMerge={longText.mergeChapter}
          onMove={longText.moveChapter}
          onCreateFromGap={longText.createChapterFromGap}
        />
      ) : (
        <StandardComposeWorkspace
          mode={mode}
          chapters={displayedChapters}
          activeIndex={activeIndex}
          title={
            compose.articleStarted
              ? (activeChapter?.title ?? compose.document.title)
              : "尚未创建文章"
          }
          saveStatus={
            <SaveStatus
              state={
                compose.isPlaceholderData || sourceLoading
                  ? "loading"
                  : sourceError
                    ? "error"
                    : compose.autosave.state
              }
              revision={activeRevision}
              savedAt={activeSavedAt}
            />
          }
          editor={editor}
          comparison={comparisonView}
          identity={identity}
          documentId={compose.document.id}
          revision={compose.autosave.revision}
          saveDisabled={!canWriteChapter || publishingScope === viewScope}
          activeCharCount={activeCharCount}
          chapterId={activeChapterStatus?.id}
          activeRevision={activeRevision}
          activeContent={editorContent}
          comparingRevision={comparingRevision}
          onCompareRevision={(revision) => void compareRevision(revision)}
          {...(canEditSelected
            ? {
                onAddChapter: compose.articleStarted
                  ? addChapter
                  : createArticle,
              }
            : {})}
          createArticle={!compose.articleStarted}
          showServerTools={
            articleSelection.authenticated &&
            compose.document.storage === "server"
          }
          {...(canEditSelected
            ? {
                onDeleteChapter: deleteChapter,
                deleteMode: usesUploadedChapters
                  ? ("server" as const)
                  : ("draft" as const),
                onToggleHidden: (index: number, hidden: boolean) =>
                  void toggleChapterHidden(index, hidden),
                onProofread: proofreadChapter,
              }
            : {})}
          hiddenChapters={navigationChapters.map(
            (chapter) => chapter.directory?.hidden ?? false,
          )}
          onSelectChapter={selectChapter}
          onSave={() => void publish()}
          onRestore={(revision) => void rollback(revision)}
          onExpand={() => setMode("full")}
        />
      )}

      <Dialog
        open={threadId !== null}
        onOpenChange={(open) => {
          if (!open) setThreadId(null);
        }}
        title="段落间贴"
        description="回复树按赞数排序，可折叠、回复和撤销赞踩。"
        className="max-w-2xl"
      >
        <CommentThread identity={identity} initial={comments} compact />
      </Dialog>
    </main>
  );
}
