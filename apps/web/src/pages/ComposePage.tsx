import type { Editor } from "@tiptap/react";
import { useQuery } from "@tanstack/react-query";
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
import { LongTextWorkspace } from "../features/compose/LongTextWorkspace";
import { SaveStatus } from "../features/compose/SaveStatus";
import { StandardComposeWorkspace } from "../features/compose/StandardComposeWorkspace";
import { useChapterUpload } from "../features/compose/useChapterUpload";
import { useComposeDocument } from "../features/compose/useComposeDocument";
import { useLongTextWorkspace } from "../features/compose/useLongTextWorkspace";
import { RevisionComparison } from "../features/comparison/RevisionComparison";
import { EditorErrorBoundary } from "../features/editor/errors/EditorErrorBoundary";
import { RichTextEditor } from "../features/editor/RichTextEditor";
import { getCommentThread, listForumChapters } from "../lib/api";
import { getRevision } from "../lib/api/revisions";
import {
  appendChapter,
  chapterTextLines,
  removeChapter,
  splitDocumentByChapters as splitDocumentByHeadings,
} from "@ricetext/document-core";
import type { CommentReply, EditorMode, RichTextNode } from "../lib/types";
import { cn } from "../lib/utils";

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
  const [mode, setMode] = useState<EditorMode>(() =>
    window.matchMedia("(max-width: 600px)").matches ? "mobile" : "full",
  );
  // 记住上次编辑的章节：刷新/重进页面后仍停留在原章节（移动端尤其依赖）。
  // 索引按文档 ID 隔离，超出章节数时由 activeIndex 钳制。
  const ACTIVE_CHAPTER_STORAGE_KEY = "ricetext:active-chapter:demo-post";
  const [chapterIndex, setChapterIndex] = useState<number>(() => {
    try {
      const stored = Number.parseInt(
        window.localStorage.getItem(ACTIVE_CHAPTER_STORAGE_KEY) ?? "",
        10,
      );
      return Number.isFinite(stored) && stored >= 0 ? stored : 1;
    } catch {
      return 1;
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
  const [notice, setNotice] = useState("");
  const [comparingRevision, setComparingRevision] = useState<number | null>(null);
  const [comparison, setComparison] = useState<{
    revision: number;
    chapterTitle: string;
    historicalContent: RichTextNode;
    currentContent: RichTextNode;
  } | null>(null);
  const editorRef = useRef<Editor | null>(null);

  const { data: chapterDirectory = [] } = useQuery({
    queryKey: ["forum", "chapters"],
    queryFn: () => listForumChapters(),
  });
  // 三个控制器通过完整文档快照衔接；页面只负责跨领域编排和提示展示。
  const compose = useComposeDocument(
    "demo-post",
    chapterDirectory[chapterIndex]?.id,
  );
  const longText = useLongTextWorkspace({
    content: compose.content,
    contentRef: compose.contentRef,
    replaceContent: compose.replaceContent,
    setAutosaveEnabled: compose.setAutosaveEnabled,
    setNotice,
  });
  const upload = useChapterUpload({
    novelId: "demo-post",
    getDocument: () => {
      // 上传准备必须先冲刷章节防抖队列，才能冻结用户眼前的最新正文。
      longText.flushEdits();
      return compose.contentRef.current;
    },
    getCoverage: () => longText.coverageChapters,
    onNotice: setNotice,
  });

  const { chapters } = useMemo(
    () => splitDocumentByHeadings(compose.content),
    [compose.content],
  );
  const activeIndex = Math.min(chapterIndex, Math.max(0, chapters.length - 1));
  // 目录「章节总结」的真实数据：字数按当前章节正文的非空白字符统计，
  // 修订号取该章节在服务端目录中的独立版本号。
  const activeCharCount = useMemo(() => {
    const chapter = chapters[activeIndex];
    if (!chapter) return 0;
    return chapterTextLines(chapter.blocks)
      .join("")
      .replace(/\s+/gu, "").length;
  }, [activeIndex, chapters]);
  const activeRevision =
    chapterDirectory[activeIndex]?.revision ?? compose.autosave.revision;
  const editorContent = useMemo<RichTextNode>(
    () => ({ type: "doc", content: chapters[activeIndex]?.blocks ?? [] }),
    [activeIndex, chapters],
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

  // 删除章节：只改本地正文（自动保存只写浏览器草稿），点击「保存」才同步服务器。
  const deleteChapter = (index: number) => {
    const result = removeChapter(compose.contentRef.current, index);
    if (!result.removed) return;
    const next = result.document as RichTextNode;
    compose.replaceContent(next);
    const remaining = splitDocumentByHeadings(next).chapters.length;
    setChapterIndex(Math.min(index, Math.max(0, remaining - 1)));
    setNotice(
      `已删除章节「${result.removed.title}」（仅本地草稿，点保存后生效）`,
    );
  };

  const publish = async (latestContent?: RichTextNode) => {
    if (longText.enabled) {
      await longText.saveDraft();
      return;
    }
    const snapshot =
      latestContent ??
      (editorRef.current?.getJSON() as RichTextNode | undefined);
    const saved = await compose.publishChapter(activeIndex, snapshot);
    if (!saved) return;
    setNotice(
      mode === "compact"
        ? "回复已进入发布队列"
        : "正文已保存，可切换到阅读视图检查",
    );
  };

  const editor = (
    <RichTextEditor
      key={
        longText.enabled ? `long-text-${longText.documentVersion}` : activeIndex
      }
      content={longText.enabled ? longText.editorContent : editorContent}
      mode={mode}
      editable={!compose.isPlaceholderData}
      longTextMode={longText.enabled}
      onChange={(next) => {
        if (compose.isPlaceholderData) return;
        if (longText.enabled) longText.updateEditor(next);
        else compose.updateChapter(activeIndex, next);
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
          <Button
            size="sm"
            variant={longText.enabled ? "secondary" : "outline"}
            aria-pressed={longText.enabled}
            onClick={() => {
              if (longText.enabled) longText.close();
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
          isPlaceholderData={compose.isPlaceholderData}
          uploadOpen={upload.open}
          uploadDiff={upload.diff}
          preparingUpload={upload.preparing}
          uploading={upload.uploading}
          onChapterTitleStyleChange={longText.setChapterTitleStyle}
          onImportFile={longText.importFile}
          onRestoreDraft={longText.restoreDraft}
          onPrepareUpload={upload.prepare}
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
          chapters={chapters}
          activeIndex={activeIndex}
          title={chapters[activeIndex]?.title ?? compose.document.title}
          saveStatus={
            <SaveStatus
              state={
                compose.isPlaceholderData ? "loading" : compose.autosave.state
              }
              revision={
                chapterDirectory[activeIndex]?.revision ??
                compose.autosave.revision
              }
              savedAt={compose.autosave.savedAt}
            />
          }
          editor={editor}
          comparison={comparisonView}
          identity={identity}
          documentId={compose.document.id}
          revision={compose.autosave.revision}
          saveDisabled={compose.isPlaceholderData}
          activeCharCount={activeCharCount}
          activeRevision={activeRevision}
          activeContent={editorContent}
          comparingRevision={comparingRevision}
          onCompareRevision={(revision) => void compareRevision(revision)}
          onAddChapter={addChapter}
          onDeleteChapter={deleteChapter}
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
