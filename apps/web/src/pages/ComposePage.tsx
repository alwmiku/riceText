import type { Editor } from "@tiptap/react";
import type { ChapterTitleStyle } from "@ricetext/editor-core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BookOpen,
  Check,
  CloudOff,
  FileUp,
  LoaderCircle,
  Maximize2,
  MessageCircle,
  Monitor,
  Save,
  Smartphone,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useAppContext } from "../app-context";
import { Button, Dialog, Segmented } from "../components/ui";
import { CommentThread } from "../features/comments/CommentThread";
import { ChapterRail, DemoBusinessPanel } from "../features/demo/DemoPanels";
import { RichTextEditor } from "../features/editor/RichTextEditor";
import { createLongTextDocument } from "../features/editor/long-text-import";
import { useAutosave } from "../features/editor/useAutosave";
import {
  getCommentThread,
  getDocument,
  listDemoChapters,
  restoreRevision,
} from "../lib/api";
import { mergeChapter, splitDocumentByHeadings } from "../lib/chapters";
import {
  loadLongTextDraft,
  saveLongTextDraft,
} from "../lib/long-text-draft-storage";
import { defaultDocument } from "../lib/seed";
import type {
  CommentReply,
  DocumentEnvelope,
  EditorMode,
  RichTextNode,
  SaveState,
} from "../lib/types";
import { cn, formatTime } from "../lib/utils";

const LOCAL_LONG_TEXT_KEY = "ricetext:local-long-text:demo-post";

const chapterStyleOptions: Array<{ value: ChapterTitleStyle; label: string }> = [
  { value: "auto", label: "自动识别" },
  { value: "chinese", label: "中文：第 X 章" },
  { value: "english", label: "English: Chapter X" },
  { value: "numeric", label: "数字：1. 标题" },
];

const statusLabels: Record<SaveState, string> = {
  loading: "正在载入",
  saved: "已保存",
  dirty: "等待保存",
  saving: "正在保存",
  conflict: "版本冲突",
  offline: "本地演示副本",
  error: "保存失败",
};

/** 紧凑展示自动保存状态、revision 和最近保存时间。 */
function SaveStatus({
  state,
  revision,
  savedAt,
}: {
  state: SaveState;
  revision: number;
  savedAt: string;
}) {
  return (
    <span className="save-status" data-state={state}>
      {state === "saving" ? (
        <LoaderCircle size={12} className="animate-spin" />
      ) : state === "offline" ? (
        <CloudOff size={12} />
      ) : (
        <span className="save-dot" />
      )}
      <span>
        {statusLabels[state]} · v{revision}
      </span>
      {(state === "saved" || state === "offline") && (
        <span className="desktop-only">· {formatTime(savedAt)}</span>
      )}
    </span>
  );
}

/** 独立发帖/章节创作工作台，负责组合编辑器、历史、间贴和演示业务面板。 */
export default function ComposePage() {
  const { identity } = useAppContext();
  const queryClient = useQueryClient();
  const { data = defaultDocument, isPlaceholderData } = useQuery({
    queryKey: ["document", "demo-post"],
    queryFn: ({ signal }) => getDocument("demo-post", signal),
    placeholderData: defaultDocument,
  });
  const [document, setDocument] = useState<DocumentEnvelope>(data);
  const [content, setContent] = useState<RichTextNode>(data.content);
  const [generation, setGeneration] = useState(0);
  const contentRef = useRef<RichTextNode>(data.content);
  const longTextFileInputRef = useRef<HTMLInputElement | null>(null);
  const generationRef = useRef(0);
  const editorRef = useRef<Editor | null>(null);
  const longTextDraftReadyRef = useRef(false);
  const longTextOperationRef = useRef(0);
  const normalContentRef = useRef<RichTextNode | null>(null);
  const [longTextMode, setLongTextMode] = useState(false);
  const [hasLocalDraft, setHasLocalDraft] = useState(false);
  const [longTextDocumentVersion, setLongTextDocumentVersion] = useState(0);
  const [chapterTitleStyle, setChapterTitleStyle] =
    useState<ChapterTitleStyle>("auto");
  const [chapterIndex, setChapterIndex] = useState(1);
  const [mode, setMode] = useState<EditorMode>(() =>
    window.matchMedia("(max-width: 600px)").matches ? "mobile" : "full",
  );
  const [threadId, setThreadId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const { data: chapterDirectory = [] } = useQuery({
    queryKey: ["demo", "chapters"],
    queryFn: () => listDemoChapters(),
  });
  const { data: comments = [] } = useQuery<CommentReply[]>({
    queryKey: ["comments", document.id, threadId],
    queryFn: () => getCommentThread(document.id, threadId!),
    enabled: Boolean(threadId),
  });

  // placeholder 让首屏立即有内容；只有尚未编辑且服务器数据确实更新（revision 更高）时，
  // 才用真实服务器文档替换正文，避免 fetch 失败回退的旧种子数据覆盖已保存的编辑。
  useEffect(() => {
    if (generation !== 0) return;
    if (data.revision <= document.revision) return;
    setDocument(data);
    contentRef.current = data.content;
    generationRef.current = 0;
    setContent(data.content);
  }, [data, generation, document.revision]);
  const draftSaveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (
      !longTextMode ||
      !longTextDraftReadyRef.current ||
      generation === 0
    )
      return;
    if (draftSaveTimerRef.current !== null)
      window.clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = window.setTimeout(() => {
      void saveLongTextDraft(LOCAL_LONG_TEXT_KEY, contentRef.current).catch(
        () => {
          setNotice("本机草稿保存失败，请检查浏览器存储空间");
        },
      );
    }, 1500);
    return () => {
      if (draftSaveTimerRef.current !== null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
    };
  }, [content, generation, longTextMode]);

  // 一章一界面：普通模式把完整文档按二级标题切分为章节；长文本模式不经过该切分。
  const { chapters } = useMemo(
    () =>
      longTextMode
        ? { lead: [], chapters: [] }
        : splitDocumentByHeadings(content),
    [content, longTextMode],
  );
  const activeIndex = Math.min(chapterIndex, Math.max(0, chapters.length - 1));
  const editorContent = useMemo<RichTextNode>(
    () => ({ type: "doc", content: chapters[activeIndex]?.blocks ?? [] }),
    [chapters, activeIndex],
  );
  const autosave = useAutosave({
    document,
    content,
    generation,
    enabled: !longTextMode,
    ...(chapters[activeIndex] ? { chapterId: chapters[activeIndex]!.id } : {}),
    onSaved: (next) => {
      setDocument((current) => ({
        ...current,
        content: next.content,
        revision: next.revision,
        savedAt: next.savedAt,
        storage: next.storage ?? current.storage ?? "server",
      }));
      queryClient.setQueryData<DocumentEnvelope>(["document", next.id], next);
      void queryClient.invalidateQueries({
        queryKey: ["revisions", next.id],
      });
      // 章节独立版本：保存后刷新章节目录，更新当前章节的版本号。
      void queryClient.invalidateQueries({
        queryKey: ["demo", "chapters"],
      });
    },
  });
  // Tiptap 初始化时可能规范化 JSON；服务器查询完成前忽略这类非用户更新，避免错误 baseRevision。
  // 普通模式只合并当前章节；长文本模式直接维护完整的 longTextBlock 文档。
  const replaceContent = (next: RichTextNode) => {
    contentRef.current = next;
    generationRef.current += 1;
    setContent(next);
    setGeneration(generationRef.current);
  };
  const replaceLongTextDocument = (next: RichTextNode) => {
    replaceContent(next);
    setLongTextDocumentVersion((version) => version + 1);
  };
  const updateContent = (next: RichTextNode) => {
    if (isPlaceholderData) return;
    if (longTextMode) {
      replaceContent(next);
      return;
    }
    const merged = mergeChapter(contentRef.current, activeIndex, next);
    replaceContent(merged);
  };
  const closeLongTextMode = () => {
    longTextOperationRef.current += 1;
    longTextDraftReadyRef.current = false;
    if (draftSaveTimerRef.current !== null) {
      window.clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    if (generationRef.current > 0) {
      void saveLongTextDraft(LOCAL_LONG_TEXT_KEY, contentRef.current).catch(
        () => {
          setNotice("本机草稿保存失败，请检查浏览器存储空间");
        },
      );
    }
    if (normalContentRef.current) {
      replaceContent(normalContentRef.current);
      normalContentRef.current = null;
    }
    setLongTextMode(false);
  };
  const openLongTextMode = async () => {
    const operation = ++longTextOperationRef.current;
    normalContentRef.current = contentRef.current;
    longTextDraftReadyRef.current = false;
    setHasLocalDraft(false);
    setLongTextMode(true);
    replaceLongTextDocument({ type: "doc", content: [] });
    try {
      const stored = await loadLongTextDraft(LOCAL_LONG_TEXT_KEY);
      if (operation !== longTextOperationRef.current) return;
      if (stored && (stored.content ?? []).length > 0) {
        setHasLocalDraft(true);
        setNotice("检测到本机草稿，可点击“恢复本机草稿”");
      } else {
        setNotice("长文本工作台已就绪，可导入 .txt 或开始写作");
      }
    } catch {
      if (operation === longTextOperationRef.current)
        setNotice("无法读取本机草稿，已打开空白长文本工作台");
    } finally {
      if (operation === longTextOperationRef.current)
        longTextDraftReadyRef.current = true;
    }
  };

  const restoreLongTextDraft = async () => {
    const operation = ++longTextOperationRef.current;
    longTextDraftReadyRef.current = false;
    try {
      const stored = await loadLongTextDraft(LOCAL_LONG_TEXT_KEY);
      if (operation !== longTextOperationRef.current) return;
      if (stored) {
        replaceLongTextDocument(stored);
        setHasLocalDraft(false);
        setNotice("已恢复本机草稿");
      } else {
        setHasLocalDraft(false);
        setNotice("没有可恢复的本机草稿");
      }
    } catch {
      if (operation === longTextOperationRef.current)
        setNotice("无法读取本机草稿，请检查浏览器存储");
    } finally {
      if (operation === longTextOperationRef.current)
        longTextDraftReadyRef.current = true;
    }
  };
  const handleLongTextImport = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      if (!text.trim()) {
        setNotice("未导入空白文本");
        return;
      }
      const imported = createLongTextDocument(text, chapterTitleStyle);
      longTextOperationRef.current += 1;
      longTextDraftReadyRef.current = true;
      setHasLocalDraft(false);
      replaceLongTextDocument(imported);
      setLongTextMode(true);
      setNotice(`已导入 ${file.name}，共 ${text.length.toLocaleString()} 字`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "文本导入失败");
    }
  };
  // 回滚响应已经是一个新 revision；编辑器通过受控 content 同步显示该快照。
  const rollback = async (revision: number) => {
    try {
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
      setNotice(`已回退到版本 ${revision}，并创建版本 ${next.revision}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "版本回退失败");
    }
  };
  // 显式发布先 flush，保证提示出现时最新正文已经进入保存队列。
  const publish = async (latestContent?: RichTextNode) => {
    if (longTextMode) {
      const snapshot = latestContent ?? contentRef.current;
      replaceContent(snapshot);
      try {
        await saveLongTextDraft(LOCAL_LONG_TEXT_KEY, snapshot);
        setHasLocalDraft(false);
        setNotice("长文本已保存在本机；上传时将按章节分别提交");
      } catch {
        setNotice("本机草稿保存失败，请检查浏览器存储空间");
      }
      return;
    }
    if (isPlaceholderData) return;
    const snapshot =
      latestContent ??
      (editorRef.current?.getJSON() as RichTextNode | undefined);
    if (snapshot) {
      const next = longTextMode
        ? snapshot
        : mergeChapter(contentRef.current, activeIndex, snapshot);
      if (JSON.stringify(next) !== JSON.stringify(contentRef.current)) {
        replaceContent(next);
      }
    }
    const saved = await autosave.flush(
      contentRef.current,
      generationRef.current,
    );
    if (!saved) return;
    setNotice(
      mode === "compact"
        ? "回复已进入演示发布队列"
        : "正文已保存，可切换到阅读视图检查",
    );
  };

  const editor = (
    <RichTextEditor
      // 导入或恢复整本草稿时重建编辑器；普通输入不改变该版本，保留编辑体验。
      key={
        longTextMode ? `long-text-${longTextDocumentVersion}` : activeIndex
      }
      content={longTextMode ? content : editorContent}
      mode={mode}
      editable={!isPlaceholderData}
      longTextMode={longTextMode}
      onChange={updateContent}
      onSubmit={(latestContent) => void publish(latestContent)}
      savedAt={autosave.savedAt}
      onReady={(editorInstance) => {
        editorRef.current = editorInstance;
      }}
      onExpand={() => setMode("full")}
      onModeToolsOpen={() => setMode("full")}
      onCommentAnchorOpen={setThreadId}
    />
  );
  return (
    <main className="app-main">
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
            variant={longTextMode ? "secondary" : "outline"}
            aria-pressed={longTextMode}
            onClick={() => {
              if (longTextMode) closeLongTextMode();
              else openLongTextMode();
            }}
          >
            <BookOpen size={14} />
            长文本
          </Button>
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
            { value: "mobile", label: "移动", icon: <Smartphone size={14} /> },
            ]}
          />
        </div>
      </div>
      {(autosave.state === "conflict" ||
        (autosave.state === "error" && autosave.conflictMessage)) && (
        <div
          className={cn(
            "mb-3 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-xs",
            autosave.state === "conflict"
              ? "border-[#e5b75e] bg-[#fff9eb] text-[#72500f]"
              : "border-[#f0b4b0] bg-[#fdf1f0] text-[#8f2b24]",
          )}
        >
          <AlertTriangle size={16} />
          <span className="min-w-[220px] flex-1">
            {autosave.conflictMessage}
          </span>
          {autosave.state === "error" ? (
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
                    JSON.stringify(content, null, 2),
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
      )}
      {notice && (
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
      )}
      {longTextMode ? (
        <section className="mx-auto max-w-[1180px]">
          <div className="document-bar surface mb-2">
            <div className="min-w-0">
              <p className="document-title">长文本工作台</p>
              <SaveStatus
                state={isPlaceholderData ? "loading" : autosave.state}
                revision={autosave.revision}
                savedAt={autosave.savedAt}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={longTextFileInputRef}
                type="file"
                accept="text/plain,.txt"
                className="sr-only"
                aria-label="导入长文本文件"
                onChange={(event) => void handleLongTextImport(event)}
              />
              <label className="sr-only" htmlFor="long-text-heading-style">
                章节标题风格
              </label>
              <select
                id="long-text-heading-style"
                className="h-8 border bg-background px-2 text-xs"
                value={chapterTitleStyle}
                onChange={(event) =>
                  setChapterTitleStyle(event.target.value as ChapterTitleStyle)
                }
                aria-label="章节标题风格"
              >
                {chapterStyleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                disabled={isPlaceholderData}
                onClick={() => longTextFileInputRef.current?.click()}
              >
                <FileUp size={14} />
                导入 .txt
              </Button>
              {hasLocalDraft && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void restoreLongTextDraft()}
                >
                  恢复本机草稿
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={closeLongTextMode}
              >
                退出长文本
              </Button>
            </div>
          </div>
          {editor}
        </section>
      ) : mode === "full" ? (
        <div className="editor-workspace">
          <ChapterRail
            chapters={chapters}
            currentIndex={activeIndex}
            onSelect={setChapterIndex}
          />
          <section className="editor-column">
            <div className="document-bar surface mb-2">
              <div className="min-w-0">
                <p className="document-title">
                  {chapters[activeIndex]?.title ?? document.title}
                </p>
                <SaveStatus
                  state={isPlaceholderData ? "loading" : autosave.state}
                  revision={
                    chapterDirectory[activeIndex]?.revision ?? autosave.revision
                  }
                  savedAt={autosave.savedAt}
                />
              </div>
              <Button
                size="sm"
                disabled={isPlaceholderData}
                onClick={() => void publish()}
              >
                <Save size={14} />
                保存
              </Button>
            </div>
            {editor}
          </section>
          <DemoBusinessPanel
            identity={identity}
            documentId={document.id}
            baseRevision={autosave.revision}
            onRestore={(revision) => void rollback(revision)}
          />
        </div>
      ) : (
        <section>
          <div className="mx-auto mb-2 flex max-w-[860px] items-center justify-between px-1">
            <SaveStatus
              state={isPlaceholderData ? "loading" : autosave.state}
              revision={autosave.revision}
              savedAt={autosave.savedAt}
            />
            {mode === "compact" && (
              <Button variant="ghost" size="sm" onClick={() => setMode("full")}>
                <Maximize2 size={14} />
                展开
              </Button>
            )}
          </div>
          {editor}
        </section>
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
