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
import { useMemo, useRef, useState } from "react";
import { useAppContext } from "../app-context";
import { Button, Dialog, Segmented } from "../components/ui";
import { CommentThread } from "../features/comments/CommentThread";
import { LongTextWorkspace } from "../features/compose/LongTextWorkspace";
import { SaveStatus } from "../features/compose/SaveStatus";
import { StandardComposeWorkspace } from "../features/compose/StandardComposeWorkspace";
import { useChapterUpload } from "../features/compose/useChapterUpload";
import { useComposeDocument } from "../features/compose/useComposeDocument";
import { useLongTextWorkspace } from "../features/compose/useLongTextWorkspace";
import { EditorErrorBoundary } from "../features/editor/EditorErrorBoundary";
import { RichTextEditor } from "../features/editor/RichTextEditor";
import { getCommentThread, listForumChapters } from "../lib/api";
import { splitDocumentByHeadings } from "../lib/chapters";
import type { CommentReply, EditorMode, RichTextNode } from "../lib/types";
import { cn } from "../lib/utils";

/** 创作页编排层：组合文档、长文本、上传和展示控制器，不承载各领域内部状态机。 */
export default function ComposePage() {
  const { identity } = useAppContext();
  const [mode, setMode] = useState<EditorMode>(() =>
    window.matchMedia("(max-width: 600px)").matches ? "mobile" : "full",
  );
  const [chapterIndex, setChapterIndex] = useState(1);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
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
  const editorContent = useMemo<RichTextNode>(
    () => ({ type: "doc", content: chapters[activeIndex]?.blocks ?? [] }),
    [activeIndex, chapters],
  );
  const { data: comments = [] } = useQuery<CommentReply[]>({
    queryKey: ["comments", compose.document.id, threadId],
    queryFn: () => getCommentThread(compose.document.id, threadId!),
    enabled: Boolean(threadId),
  });

  const rollback = async (revision: number) => {
    try {
      const next = await compose.rollback(revision);
      setNotice(`已回退到版本 ${revision}，并创建版本 ${next.revision}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "版本回退失败");
    }
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
          identity={identity}
          documentId={compose.document.id}
          revision={compose.autosave.revision}
          saveDisabled={compose.isPlaceholderData}
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
