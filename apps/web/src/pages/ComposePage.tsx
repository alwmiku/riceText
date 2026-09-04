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
} from "../lib/types";
import { cn, sha256Hex } from "../lib/utils";

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
  if (value < 20)
    return `十${value > 10 ? CHINESE_NUMERALS[value % 10] : ""}`;
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
  // 索引按文档 ID 隔离，超出章节数时由 activeIndex 钳制。
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
  const [threadId, setThreadId] = useState<string | null>(null);
  const [newArticleDialogOpen, setNewArticleDialogOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [comparingRevision, setComparingRevision] = useState<number | null>(null);
  const [comparison, setComparison] = useState<{
    revision: number;
    chapterTitle: string;
    historicalContent: RichTextNode;
    currentContent: RichTextNode;
  } | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const articleSwitchRef = useRef(false);
  const [switchingArticle, setSwitchingArticle] = useState(false);

  const { data: chapterDirectory = [] } = useQuery({
    queryKey: ["forum", "chapters", activeDocumentId],
    queryFn: () => listForumChapters(activeDocumentId),
    enabled: articleSelection.authenticated && !articleSelection.loading,
  });
  // 三个控制器通过完整文档快照衔接；页面只负责跨领域编排和提示展示。
  const compose = useComposeDocument(activeDocumentId, chapterIndex, {
    serverEnabled: articleSelection.authenticated && !articleSelection.loading,
    localOnly: !articleSelection.authenticated,
    initialTitle: articleSelection.selectedDraftTitle,
  });
  const longText = useLongTextWorkspace({
    documentId: activeDocumentId,
    content: compose.content,
    contentRef: compose.contentRef,
    replaceContent: compose.replaceContent,
    setAutosaveEnabled: compose.setAutosaveEnabled,
    setNotice,
  });
  const upload = useChapterUpload({
    novelId: activeDocumentId,
    getDocument: () => {
      // 上传准备必须先冲刷章节防抖队列，才能冻结用户眼前的最新正文。
      longText.flushEdits();
      return compose.contentRef.current;
    },
    getCoverage: () => longText.coverageChapters,
    ensureDocument: () =>
      compose.ensureServerDocument(longText.getBaseContent()),
    onNotice: setNotice,
  });

  const { chapters } = useMemo(
    () => splitDocumentByHeadings(compose.content),
    [compose.content],
  );
  const isBlankDocumentShell = (compose.content.content ?? []).every(
    (node) =>
      node.type === "paragraph" &&
      (!node.content || node.content.length === 0),
  );
  const usesUploadedChapters =
    isBlankDocumentShell &&
    chapterDirectory.some(
      (chapter) =>
        chapter.hasContent === true ||
        (chapter.hasContent === undefined && chapter.revision > 0),
    );
  const navigationChapters = usesUploadedChapters
    ? chapterDirectory.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        volumeTitle: chapter.volumeTitle ?? "",
        blocks: [],
        start: chapter.order,
        end: chapter.order + 1,
      }))
    : chapters;
  const displayedChapters = compose.articleStarted ? navigationChapters : [];
  const activeIndex = Math.min(
    chapterIndex,
    Math.max(0, navigationChapters.length - 1),
  );
  // 目录「章节总结」的真实数据：字数按当前章节正文的非空白字符统计，
  // 修订号取该章节在服务端目录中的独立版本号。
  const activeChapterStatus = chapterDirectory[activeIndex];
  const uploadedChapterKey = [
    "forum",
    "chapter-content",
    activeDocumentId,
    activeChapterStatus?.id,
  ] as const;
  const { data: uploadedChapter } = useQuery({
    queryKey: uploadedChapterKey,
    queryFn: ({ signal }) =>
      getLongTextChapter(activeDocumentId, activeChapterStatus!.id, signal),
    enabled:
      usesUploadedChapters &&
      Boolean(activeChapterStatus?.id) &&
      activeChapterStatus?.hasContent !== false,
  });
  const activeCharCount = useMemo(() => {
    const blocks = usesUploadedChapters
      ? ((uploadedChapter?.content.content ?? []) as RichTextNode[])
      : (chapters[activeIndex]?.blocks ?? []);
    return chapterTextLines(blocks).join("").replace(/\s+/gu, "").length;
  }, [activeIndex, chapters, uploadedChapter?.content.content, usesUploadedChapters]);
  const activeRevision = activeChapterStatus?.revision ?? 0;
  const activeSavedAt =
    compose.autosave.state === "saved"
      ? (activeChapterStatus?.savedAt ?? compose.document.savedAt)
      : compose.autosave.savedAt;
  const editorContent = useMemo<RichTextNode>(
    () =>
      usesUploadedChapters && uploadedChapter
        ? (uploadedChapter.content as RichTextNode)
        : { type: "doc", content: chapters[activeIndex]?.blocks ?? [] },
    [activeIndex, chapters, uploadedChapter, usesUploadedChapters],
  );
  const { data: comments = [] } = useQuery<CommentReply[]>({
    queryKey: ["comments", compose.document.id, threadId],
    queryFn: () => getCommentThread(compose.document.id, threadId!),
    enabled: Boolean(threadId),
  });

  const compareRevision = async (revision: number) => {
    setComparingRevision(revision);
    try {
      const snapshot = await getRevision(compose.document.id, revision);
      const targetChapters = splitDocumentByHeadings(snapshot.content).chapters;
      setComparison({
        revision,
        chapterTitle: chapters[activeIndex]?.title ?? compose.document.title,
        historicalContent: {
          type: "doc",
          content: targetChapters[activeIndex]?.blocks ?? [],
        },
        currentContent: {
          type: "doc",
          content: chapters[activeIndex]?.blocks ?? [],
        },
      });
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "版本比较加载失败");
    } finally {
      setComparingRevision(null);
    }
  };

  const rollback = async (revision: number) => {
    try {
      const next = await compose.rollback(revision);
      setNotice(`已回退到版本 ${revision}，并创建版本 ${next.revision}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "版本回退失败");
    }
  };

  // 隐藏/恢复章节：隐藏后读者不可读，作者写完取消隐藏后恢复可读。
  const toggleChapterHidden = async (index: number, hidden: boolean) => {
    const row = chapterDirectory[index];
    if (!row) {
      setNotice("该章节尚未注册到服务器（保存后才会创建），暂时无法设置隐藏");
      return;
    }
    try {
      await setDocumentChapterHidden(compose.document.id, row.id, hidden);
      void queryClient.invalidateQueries({ queryKey: ["forum", "chapters"] });
      setNotice(
        hidden
          ? `已隐藏「${chapters[index]?.title ?? ""}」，读者在取消隐藏前不可见`
          : `「${chapters[index]?.title ?? ""}」已恢复可读`,
      );
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? `设置章节可见性失败：${cause.message}`
          : "设置章节可见性失败",
      );
    }
  };

  // 校订章节：与阅读页「开始校订」一致（字级 diff 校订视图）。
  const proofreadChapter = (index: number) => {
    navigate(`/read?chapter=${index}&proofread=1`);
  };

  // 空库先建立纯本地空白文章；只有之后点击保存才会创建服务器首版。
  const createArticle = () => setNewArticleDialogOpen(true);

  useEffect(() => {
    if (
      articleSelection.loading ||
      selectedArticle ||
      !articleSelection.selectedDraftTitle ||
      compose.articleStarted
    ) return;
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
    const current = compose.contentRef.current;
    const number = splitDocumentByHeadings(current).chapters.length + 1;
    const result = appendChapter(
      current,
      `第${toChineseNumber(number)}章 新章节`,
    );
    compose.replaceContent(result.document as RichTextNode);
    setChapterIndex(result.index);
    setNotice(`已新增第 ${number} 章，保存后目录与版本号会同步更新`);
  };

  // 删除章节：正文先移除（自动保存只写浏览器草稿，点保存生效），
  // 同时调用删除章节接口清理服务器目录行（幂等；离线时留给保存对账清理）。
  const deleteChapter = async (index: number) => {
    if (usesUploadedChapters) {
      const row = chapterDirectory[index];
      if (!row) return;
      try {
        const outcome = await deleteDocumentChapter(activeDocumentId, row.id);
        if (!outcome.deleted) {
          setNotice("该服务器章节已经不存在，目录即将刷新");
        } else {
          setNotice(`已从服务器删除章节「${row.title}」`);
        }
        queryClient.setQueryData<ForumChapterItem[]>(
          ["forum", "chapters", activeDocumentId],
          (current = []) => current.filter((chapter) => chapter.id !== row.id),
        );
        setChapterIndex(
          Math.min(index, Math.max(0, chapterDirectory.length - 2)),
        );
        void queryClient.invalidateQueries({
          queryKey: ["forum", "chapters", activeDocumentId],
        });
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "服务器章节删除失败");
      }
      return;
    }
    const result = removeChapter(compose.contentRef.current, index);
    if (!result.removed) return;
    const next = result.document as RichTextNode;
    compose.replaceContent(next);
    const remaining = splitDocumentByHeadings(next).chapters.length;
    setChapterIndex(Math.min(index, Math.max(0, remaining - 1)));
    setNotice(
      `已删除章节「${result.removed.title}」（仅本地草稿，点保存后生效）`,
    );
    try {
      const outcome = await deleteDocumentChapter(
        compose.document.id,
        result.removed.id,
      );
      if (outcome.deleted) {
        void queryClient.invalidateQueries({
          queryKey: ["forum", "chapters"],
        });
      }
    } catch {
      setNotice(
        `已从本地草稿删除「${result.removed.title}」，服务器目录将在下次保存时重新对账`,
      );
    }
  };

  const publish = async (latestContent?: RichTextNode) => {
    if (longText.enabled) {
      await longText.saveDraft();
      return;
    }
    if (usesUploadedChapters && activeChapterStatus) {
      const snapshot = latestContent ?? editorContent;
      try {
        const hash = await sha256Hex(
          JSON.stringify({
            title: activeChapterStatus.title,
            order: activeChapterStatus.order,
            content: snapshot,
          }),
        );
        const saved = await uploadLongTextChapter(
          activeDocumentId,
          activeChapterStatus.id,
          {
            title: activeChapterStatus.title,
            order: activeChapterStatus.order,
            content: snapshot,
            hash,
            baseRevision:
              uploadedChapter?.revision ?? activeChapterStatus.revision,
          },
        );
        queryClient.setQueryData(uploadedChapterKey, (current: typeof uploadedChapter) =>
          current
            ? { ...current, content: snapshot, revision: saved.revision }
            : current,
        );
        void queryClient.invalidateQueries({
          queryKey: ["forum", "chapters", activeDocumentId],
        });
        setNotice("章节已保存为版本 " + String(saved.revision));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "章节保存失败");
      }
      return;
    }
    const snapshot =
      latestContent ??
      (editorRef.current?.getJSON() as RichTextNode | undefined);
    // 用文档缓存修订号判断本次保存是否真的产生了新修订：无内容差异时服务器
    // 不会建版（章节版本号与历史也在首次实际保存时才生成），不能提示“已保存”。
    const latestBefore = queryClient.getQueryData<DocumentEnvelope>([
      "document",
      compose.document.id,
    ])?.revision ?? compose.autosave.revision;
    try {
      const saved = await compose.publishChapter(activeIndex, snapshot);
      if (!saved) return;
      const latestAfter = queryClient.getQueryData<DocumentEnvelope>([
        "document",
        compose.document.id,
      ])?.revision;
      setNotice(
        latestAfter === undefined || latestAfter === latestBefore
          ? "内容没有变化，未创建新版本；该章的版本号与历史在首次实际保存时生成"
          : mode === "compact"
            ? "回复已进入发布队列"
            : "正文已保存，可切换到阅读视图检查",
      );
    } catch (cause) {
      // 新增章节注册失败时中止保存并提示，避免产生没有归属的修订。
      setNotice(
        cause instanceof Error
          ? `新增章节注册失败：${cause.message}`
          : "新增章节注册失败，请稍后重试",
      );
    }
  };

  const editor = (
    <RichTextEditor
      key={
        longText.enabled
          ? `long-text-${activeDocumentId}-${longText.documentVersion}`
          : `chapter-${activeDocumentId}-${activeIndex}`
      }
      content={longText.enabled ? longText.editorContent : editorContent}
      mode={mode}
      editable={
        !compose.isPlaceholderData && compose.articleStarted && canEditSelected
      }
      longTextMode={longText.enabled}
      onChange={(next) => {
        if (compose.isPlaceholderData) return;
        if (longText.enabled) longText.updateEditor(next);
        else if (usesUploadedChapters && activeChapterStatus) {
          queryClient.setQueryData(
            uploadedChapterKey,
            (current: typeof uploadedChapter) =>
              current ? { ...current, content: next } : current,
          );
        } else compose.updateChapter(activeIndex, next);
      }}
      onSplitChapter={longText.splitChapter}
      onChapterEdit={longText.editChapter}
      onSubmit={(latestContent) => void publish(latestContent)}
      savedAt={compose.autosave.savedAt}
      onReady={(editorInstance) => {
        editorRef.current = editorInstance;
      }}
      onExpand={() => setMode("full")}
      onModeToolsOpen={() => setMode("full")}
      onCommentAnchorOpen={setThreadId}
    />
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
        <div className="flex flex-wrap items-center justify-end gap-2">
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
                  upload.cancel();
                  articleSelection.setSelectedId(id);
                  const stored = Number.parseInt(
                    window.localStorage.getItem(`ricetext:active-chapter:${id}`) ?? "",
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
              ? chapters[activeIndex]?.title ?? compose.document.title
              : "尚未创建文章"
          }
          saveStatus={
            <SaveStatus
              state={
                compose.isPlaceholderData ? "loading" : compose.autosave.state
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
          saveDisabled={
            compose.isPlaceholderData || !compose.articleStarted || !canEditSelected
          }
          activeCharCount={activeCharCount}
          chapterId={chapterDirectory[activeIndex]?.id}
          activeRevision={activeRevision}
          activeContent={editorContent}
          comparingRevision={comparingRevision}
          onCompareRevision={(revision) => void compareRevision(revision)}
          {...(canEditSelected
            ? {
                onAddChapter: compose.articleStarted ? addChapter : createArticle,
              }
            : {})}
          createArticle={!compose.articleStarted}
          showServerTools={
            articleSelection.authenticated && compose.document.storage === "server"
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
          hiddenChapters={chapterDirectory.map((chapter) => chapter.hidden)}
          onSelectChapter={setChapterIndex}
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
