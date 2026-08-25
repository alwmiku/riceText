import type { Editor } from "@tiptap/react";
import type { ChapterTitleStyle } from "@ricetext/editor-core";
import { MAX_CHAPTER_LENGTH } from "@ricetext/editor-core";
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
  PanelLeftOpen,
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
import { EditorErrorBoundary } from "../features/editor/EditorErrorBoundary";
import { createLongTextDocument } from "../features/editor/long-text-import";
import {
  expandRawRangeToIncludeLeadingTitle,
  rawRangeForGapChapter,
  splitRawRangeAtCursor,
} from "../features/editor/long-text-ranges";
import { useAutosave } from "../features/editor/useAutosave";
import {
  ChapterSidebar,
  type ChapterSummary,
} from "../features/novel/ChapterSidebar";
import {
  ChapterCoverageDialog,
  type CoverageChapter,
} from "../features/novel/ChapterCoverageDialog";
import {
  ChapterRawPreview,
  collectRawGaps,
} from "../features/novel/ChapterRawPreview";
import {
  getCommentThread,
  getDocument,
  listDemoChapters,
  restoreRevision,
  uploadLongTextChapter,
} from "../lib/api";
import { mergeChapter, splitDocumentByHeadings } from "../lib/chapters";
import {
  loadLongTextDraft,
  loadLongTextRaw,
  saveLongTextDraft,
  saveLongTextRaw,
} from "../lib/long-text-draft-storage";
import { defaultDocument } from "../lib/seed";
import type {
  CommentReply,
  DocumentEnvelope,
  EditorMode,
  RichTextNode,
  SaveState,
} from "../lib/types";
import { cn, formatTime, sha256Hex } from "../lib/utils";

const LOCAL_LONG_TEXT_KEY = "ricetext:local-long-text:demo-post";
const LOCAL_LONG_TEXT_RAW_KEY = "ricetext:local-long-text-raw:demo-post";

const chapterStyleOptions: Array<{ value: ChapterTitleStyle; label: string }> =
  [
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
  const dotColor =
    state === "saved"
      ? "bg-[#209065]"
      : state === "dirty" || state === "saving"
        ? "bg-[#c47b0b]"
        : state === "conflict" || state === "error"
          ? "bg-[#c83d3d]"
          : "bg-[#9aa4ae]";
  return (
    <span
      className="save-status inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-[#65717e]"
      data-state={state}
    >
      {state === "saving" ? (
        <LoaderCircle size={12} className="animate-spin" />
      ) : state === "offline" ? (
        <CloudOff size={12} />
      ) : (
        <span className={`h-[7px] w-[7px] rounded-full ${dotColor}`} />
      )}
      <span>
        {statusLabels[state]} · v{revision}
      </span>
      {(state === "saved" || state === "offline") && (
        <span className="max-[840px]:hidden">· {formatTime(savedAt)}</span>
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
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const [mobileChapterRailOpen, setMobileChapterRailOpen] = useState(false);
  const activeChapterIndexRef = useRef(0);
  const longTextPendingRef = useRef<RichTextNode | null>(null);
  const longTextWriteTimerRef = useRef<number | null>(null);
  const chapterEditTimerRef = useRef<number | null>(null);
  const chapterEditPendingRef = useRef<{
    chapterId: string;
    patch: { title?: string; text?: string };
  } | null>(null);
  const [chapterTitleStyle, setChapterTitleStyle] =
    useState<ChapterTitleStyle>("auto");
  const [chapterIndex, setChapterIndex] = useState(1);
  const [mode, setMode] = useState<EditorMode>(() =>
    window.matchMedia("(max-width: 600px)").matches ? "mobile" : "full",
  );
  const [threadId, setThreadId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [rawText, setRawText] = useState<string | null>(null);
  const [addChapterOpen, setAddChapterOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadDiff, setUploadDiff] = useState<{
    total: number;
    toUpdate: number;
    added: number;
    modified: number;
    gaps: number;
    rows: Array<{
      id: string;
      title: string;
      status: "新增" | "修改" | "未变化";
    }>;
  } | null>(null);
  const [addChapterTitle, setAddChapterTitle] = useState("");
  const [addChapterText, setAddChapterText] = useState("");
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
    return () => {
      if (longTextWriteTimerRef.current !== null)
        window.clearTimeout(longTextWriteTimerRef.current);
      if (chapterEditTimerRef.current !== null)
        window.clearTimeout(chapterEditTimerRef.current);
      if (draftSaveTimerRef.current !== null)
        window.clearTimeout(draftSaveTimerRef.current);
    };
  }, []);

  // 长文本模式不做自动保存：所有改动只存在本页内存，
  // 由“保存本机草稿”或“确定并上传”显式提交。

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
  // 长文本模式：目录摘要只来自完整章节 JSON 的轻量字段，编辑器只加载当前一章。
  const chapterSummaries = useMemo<ChapterSummary[]>(() => {
    if (!longTextMode) return [];
    return (content.content ?? []).map((node, index) => ({
      id: String(node.attrs?.chapterId ?? `chapter-${index}`),
      title: String(node.attrs?.title ?? "未命名章节"),
      charCount: String(node.attrs?.text ?? "").length,
    }));
  }, [content, longTextMode]);
  const coverageChapters = useMemo<CoverageChapter[]>(() => {
    if (!longTextMode) return [];
    let previousEnd = 0;
    return (content.content ?? []).map((node, index) => {
      const text = String(node.attrs?.text ?? "");
      const title = String(node.attrs?.title ?? "未命名章节");
      const rawStart =
        typeof node.attrs?.start === "number" ? node.attrs.start : null;
      const start = expandRawRangeToIncludeLeadingTitle(
        rawText,
        title,
        rawStart,
        previousEnd,
      );
      const end = typeof node.attrs?.end === "number" ? node.attrs.end : null;
      if (end !== null) previousEnd = Math.max(previousEnd, end);
      return {
        id: String(node.attrs?.chapterId ?? `chapter-${index}`),
        title,
        charCount: text.length,
        start,
        end,
        preview: text.slice(0, 200).replace(/\s+/g, " ").slice(0, 120),
      };
    });
  }, [content, longTextMode, rawText]);
  const longTextEditorContent = useMemo<RichTextNode>(() => {
    if (!longTextMode) return { type: "doc", content: [] };
    const block = content.content?.[activeChapterIndex];
    return block
      ? { type: "doc", content: [block] }
      : { type: "doc", content: [] };
  }, [content, longTextMode, activeChapterIndex]);
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
  /** 把编辑器返回的章节块写回完整文档；编辑器内新增章节（切章）时跳到新章并重建。 */
  const commitPendingLongText = () => {
    if (longTextWriteTimerRef.current !== null) {
      window.clearTimeout(longTextWriteTimerRef.current);
      longTextWriteTimerRef.current = null;
    }
    const pending = longTextPendingRef.current;
    longTextPendingRef.current = null;
    if (!pending) return;
    let blocks = pending.content ?? [];
    if (blocks.length > 1) {
      // 编辑器理论上只含当前一章；出现多节点说明文档被污染。
      // 只写回首块，防止普通编辑（如改标题）被误判为新增章节。
      console.warn("[长文本] 编辑器多节点文档，仅保留当前章", blocks.length);
      const first = blocks[0];
      if (!first) return;
      blocks = [first];
    }
    const list = [...(contentRef.current.content ?? [])];
    const start = activeChapterIndexRef.current;
    list.splice(start, blocks.length, ...blocks);
    const gainedChapters = blocks.length > 1;
    if (gainedChapters) {
      activeChapterIndexRef.current = start + blocks.length - 1;
    }
    replaceContent({ type: "doc", content: list });
    if (gainedChapters) {
      setActiveChapterIndex(activeChapterIndexRef.current);
      setLongTextDocumentVersion((version) => version + 1);
    }
  };
  const updateContent = (next: RichTextNode) => {
    if (isPlaceholderData) return;
    if (longTextMode) {
      const blocks = next.content ?? [];
      if (blocks.length > 1) {
        console.warn(
          "[长文本] 编辑器多节点文档",
          blocks
            .map(
              (node) =>
                `${node.type}|${String(node.attrs?.title ?? "")}|${String(node.attrs?.chapterId ?? "")}|${String(node.attrs?.text ?? "").length}`,
            )
            .join(" ; "),
        );
        // 防御：只写回首块；编辑器文档由 RichTextEditor 自动清理回单章。
        const first = blocks[0];
        if (first) {
          longTextPendingRef.current = { type: "doc", content: [first] };
        }
        return;
      }
      longTextPendingRef.current = next;
      if (longTextWriteTimerRef.current !== null)
        window.clearTimeout(longTextWriteTimerRef.current);
      longTextWriteTimerRef.current = window.setTimeout(
        commitPendingLongText,
        300,
      );
      return;
    }
    const merged = mergeChapter(contentRef.current, activeIndex, next);
    replaceContent(merged);
  };
  const selectChapter = (index: number) => {
    if (index === activeChapterIndexRef.current) return;
    commitPendingLongText();
    activeChapterIndexRef.current = index;
    setActiveChapterIndex(index);
    replaceLongTextDocument(contentRef.current);
  };

  const deleteChapter = (index: number) => {
    commitPendingLongText();
    const list = [...(contentRef.current.content ?? [])];
    if (index < 0 || index >= list.length) return;
    list.splice(index, 1);
    activeChapterIndexRef.current = Math.min(
      activeChapterIndexRef.current,
      Math.max(0, list.length - 1),
    );
    replaceLongTextDocument({ type: "doc", content: list });
    setActiveChapterIndex(activeChapterIndexRef.current);
  };

  const mergeChapterAt = (index: number) => {
    if (index <= 0) return;
    commitPendingLongText();
    const list = [...(contentRef.current.content ?? [])];
    const previous = list[index - 1];
    const current = list[index];
    if (!previous || !current) return;
    const previousText = String(previous.attrs?.text ?? "");
    const currentText = String(current.attrs?.text ?? "");
    if (previousText.length + currentText.length + 2 > MAX_CHAPTER_LENGTH)
      return;
    list.splice(index - 1, 2, {
      ...previous,
      attrs: {
        ...previous.attrs,
        text: `${previousText}\n\n${currentText}`,
        end:
          typeof current.attrs?.end === "number"
            ? current.attrs.end
            : typeof previous.attrs?.end === "number"
              ? previous.attrs.end
              : null,
      },
    });
    activeChapterIndexRef.current = index - 1;
    replaceLongTextDocument({ type: "doc", content: list });
    setActiveChapterIndex(activeChapterIndexRef.current);
  };

  const moveChapter = (from: number, to: number) => {
    if (from === to) return;
    commitPendingLongText();
    const list = [...(contentRef.current.content ?? [])];
    const [moving] = list.splice(from, 1);
    if (!moving) return;
    list.splice(to, 0, moving);
    activeChapterIndexRef.current = to;
    replaceLongTextDocument({ type: "doc", content: list });
    setActiveChapterIndex(activeChapterIndexRef.current);
  };

  /** 管理员手动添加章节（番外、作者说、短章等），追加到目录末尾。 */
  const addChapter = () => {
    const title = addChapterTitle.trim();
    const text = addChapterText.slice(0, MAX_CHAPTER_LENGTH);
    if (!title && !text) return;
    commitPendingLongText();
    const list = [...(contentRef.current.content ?? [])];
    const node: RichTextNode = {
      type: "longTextBlock",
      attrs: {
        chapterId: `manual-chapter-${Date.now()}`,
        title: title || "未命名章节",
        text,
        order: list.length,
        start: null,
        end: null,
      },
    };
    list.push(node);
    activeChapterIndexRef.current = list.length - 1;
    replaceLongTextDocument({ type: "doc", content: list });
    setActiveChapterIndex(activeChapterIndexRef.current);
    setAddChapterOpen(false);
    setAddChapterTitle("");
    setAddChapterText("");
    setNotice(`已添加章节“${title || "未命名章节"}”`);
  };

  /** 从未切分到任何章节的原文段落创建新章节（本地核对修正）。 */
  const createChapterFromGap = (text: string, start: number, end: number) => {
    if (!text.trim()) return;
    commitPendingLongText();
    const list = [...(contentRef.current.content ?? [])];
    const limitedText = text.slice(0, MAX_CHAPTER_LENGTH);
    const range = rawRangeForGapChapter(start, end, text);
    const node: RichTextNode = {
      type: "longTextBlock",
      attrs: {
        chapterId: `gap-chapter-${Date.now()}`,
        title: "未命名章节",
        text: limitedText,
        order: list.length,
        start: range.start,
        end: range.end,
      },
    };
    list.push(node);
    activeChapterIndexRef.current = list.length - 1;
    replaceLongTextDocument({ type: "doc", content: list });
    setActiveChapterIndex(activeChapterIndexRef.current);
    setNotice("已把未切分段落创建为新章节，请补充标题并核对内容");
  };

  /** 光标处切章：把当前章节拆为两章，编辑器重建后只加载新章。 */
  const splitCurrentChapter = (before: string, after: string) => {
    commitPendingLongText();
    const list = [...(contentRef.current.content ?? [])];
    const index = activeChapterIndexRef.current;
    const current = list[index];
    if (!current) return;
    const ranges = splitRawRangeAtCursor(
      current.attrs as Record<string, unknown> | undefined,
      before,
      after,
    );
    const newNode: RichTextNode = {
      type: "longTextBlock",
      attrs: {
        chapterId: `chapter-${Date.now()}`,
        title: `第 ${index + 2} 章`,
        text: after,
        order: index + 1,
        start: ranges.after.start,
        end: ranges.after.end,
      },
    };
    list.splice(
      index,
      1,
      {
        ...current,
        attrs: {
          ...current.attrs,
          text: before,
          start: ranges.before.start,
          end: ranges.before.end,
        },
      },
      newNode,
    );
    activeChapterIndexRef.current = index + 1;
    replaceLongTextDocument({ type: "doc", content: list });
    setActiveChapterIndex(activeChapterIndexRef.current);
    setNotice(
      `已在光标处拆分为“${String(current.attrs?.title ?? "当前章")}”与“第 ${index + 2} 章”`,
    );
  };

  /** 把防抖中的章节编辑写回整体文档（按章节 id 定位，不动其他章节）。 */
  const commitChapterEdit = () => {
    const pending = chapterEditPendingRef.current;
    chapterEditPendingRef.current = null;
    if (!pending) return;
    const list = contentRef.current.content ?? [];
    const index = list.findIndex(
      (node) => String(node.attrs?.chapterId) === pending.chapterId,
    );
    if (index < 0) return;
    const current = list[index];
    if (!current) return;
    const updated = {
      ...current,
      attrs: {
        ...current.attrs,
        ...(pending.patch.title !== undefined
          ? { title: pending.patch.title }
          : {}),
        ...(pending.patch.text !== undefined
          ? { text: pending.patch.text }
          : {}),
      },
    };
    replaceContent({
      type: "doc",
      content: [...list.slice(0, index), updated, ...list.slice(index + 1)],
    });
  };

  /** 章节编辑回调（来自节点视图的引用修改）：防抖后写回整体数据。 */
  const handleChapterEdit = (
    chapterId: string,
    patch: { title?: string; text?: string },
  ) => {
    chapterEditPendingRef.current = { chapterId, patch };
    if (chapterEditTimerRef.current !== null)
      window.clearTimeout(chapterEditTimerRef.current);
    chapterEditTimerRef.current = window.setTimeout(commitChapterEdit, 300);
  };

  const closeLongTextMode = () => {
    longTextOperationRef.current += 1;
    longTextDraftReadyRef.current = false;
    commitPendingLongText();
    if (longTextWriteTimerRef.current !== null) {
      window.clearTimeout(longTextWriteTimerRef.current);
      longTextWriteTimerRef.current = null;
    }
    if (draftSaveTimerRef.current !== null) {
      window.clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
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
    activeChapterIndexRef.current = 0;
    setActiveChapterIndex(0);
    setHasLocalDraft(false);
    setLongTextMode(true);
    replaceLongTextDocument({ type: "doc", content: [] });
    try {
      const raw = await loadLongTextRaw(LOCAL_LONG_TEXT_RAW_KEY);
      if (operation === longTextOperationRef.current) setRawText(raw ?? null);
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
      const raw = await loadLongTextRaw(LOCAL_LONG_TEXT_RAW_KEY);
      if (operation === longTextOperationRef.current) setRawText(raw ?? null);
      const stored = await loadLongTextDraft(LOCAL_LONG_TEXT_KEY);
      if (operation !== longTextOperationRef.current) return;
      if (stored) {
        activeChapterIndexRef.current = 0;
        setActiveChapterIndex(0);
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
  const handleLongTextImport = async (event: ChangeEvent<HTMLInputElement>) => {
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
      activeChapterIndexRef.current = 0;
      setActiveChapterIndex(0);
      setRawText(text);
      void saveLongTextRaw(LOCAL_LONG_TEXT_RAW_KEY, text).catch(() => {
        setNotice("原文快照保存失败，原文对照列可能不可用");
      });
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
  /** 准备分章上传：先展示本地核对结果（未切分段落），再逐章上传。 */
  const prepareUpload = async () => {
    commitPendingLongText();
    const nodes = contentRef.current.content ?? [];
    if (nodes.length === 0) {
      setNotice("当前没有可上传的章节");
      return;
    }
    const gaps = collectRawGaps(coverageChapters);
    setUploadDiff({
      total: nodes.length,
      toUpdate: nodes.length,
      added: nodes.length,
      modified: 0,
      gaps: gaps.length,
      rows: nodes.map((node, index) => ({
        id: String(node.attrs?.chapterId ?? `chapter-${index}`),
        title: String(node.attrs?.title ?? "未命名章节"),
        status: "新增" as const,
      })),
    });
    setUploadOpen(true);
  };

  /** 确认后分章上传：每个章节一个请求（含内容与哈希）。 */
  const confirmUpload = async () => {
    if (!uploadDiff) return;
    const nodes = contentRef.current.content ?? [];
    setUploading(true);
    let uploaded = 0;
    try {
      const directory = await listDemoChapters();
      const revisionById = new Map(
        directory.map((chapter) => [chapter.id, chapter.revision]),
      );
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        if (!node) continue;
        const chapterId = String(node.attrs?.chapterId ?? `chapter-${index}`);
        const hash = await sha256Hex(String(node.attrs?.text ?? ""));
        await uploadLongTextChapter("demo-post", chapterId, {
          title: String(node.attrs?.title ?? "未命名章节"),
          order: index,
          content: { type: "doc", content: [{ ...node }] },
          hash,
          baseRevision: revisionById.get(chapterId) ?? 0,
        });
        uploaded += 1;
      }
      setUploadOpen(false);
      setUploadDiff(null);
      setNotice(`已分章上传 ${uploaded} 章`);
      void queryClient.invalidateQueries({ queryKey: ["demo", "chapters"] });
    } catch (error) {
      setNotice(
        error instanceof Error ? `上传失败：${error.message}` : "上传失败",
      );
    } finally {
      setUploading(false);
    }
  };
  // 显式发布先 flush，保证提示出现时最新正文已经进入保存队列。
  const publish = async (latestContent?: RichTextNode) => {
    if (longTextMode) {
      commitPendingLongText();
      const snapshot = contentRef.current;
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
      key={longTextMode ? `long-text-${longTextDocumentVersion}` : activeIndex}
      content={longTextMode ? longTextEditorContent : editorContent}
      mode={mode}
      editable={!isPlaceholderData}
      longTextMode={longTextMode}
      onChange={updateContent}
      onSplitChapter={splitCurrentChapter}
      onChapterEdit={handleChapterEdit}
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
          {!longTextMode && (
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
          )}
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
        <section className="mx-auto max-w-[1680px]">
          <div className="mb-2 flex min-h-[52px] items-center justify-between gap-3 rounded-lg border border-border bg-white py-2 pr-2.5 pl-3.5 shadow-panel max-[430px]:min-h-12 max-[430px]:pr-3 max-[430px]:pl-3">
            <div className="min-w-0">
              <p className="min-w-0 truncate text-[15px] font-bold">
                长文本工作台
              </p>
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
                variant="outline"
                onClick={() => setCoverageOpen(true)}
              >
                全文对比
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddChapterOpen(true)}
              >
                添加章节
              </Button>
              <Button
                size="sm"
                disabled={uploading}
                onClick={() => void prepareUpload()}
              >
                <Save size={14} />
                {uploading ? "上传中…" : "确定并上传"}
              </Button>
              <Button size="sm" variant="ghost" onClick={closeLongTextMode}>
                退出长文本
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-[340px_minmax(420px,1fr)_minmax(0,1.6fr)] items-start gap-3 p-3">
            <ChapterSidebar
              chapters={chapterSummaries}
              activeIndex={activeChapterIndex}
              onSelect={selectChapter}
              onDelete={deleteChapter}
              onMerge={mergeChapterAt}
              onMove={moveChapter}
            />
            <ChapterRawPreview
              rawText={rawText}
              chapters={coverageChapters}
              activeIndex={activeChapterIndex}
              onCreateFromGap={createChapterFromGap}
            />
            <div className="min-w-0">
              <EditorErrorBoundary>{editor}</EditorErrorBoundary>
            </div>
          </div>
        </section>
      ) : mode === "full" ? (
        <div className="grid grid-cols-[220px_minmax(480px,1fr)_310px] items-start gap-3.5 max-[1180px]:grid-cols-[minmax(0,1fr)_300px] max-[1180px]:[&>*:first-child]:hidden max-[840px]:block max-[840px]:[&>aside]:hidden">
          <ChapterRail
            chapters={chapters}
            currentIndex={activeIndex}
            onSelect={setChapterIndex}
          />
          <section className="min-w-0">
            <div className="mb-2 flex min-h-[52px] items-center justify-between gap-3 rounded-lg border border-border bg-white py-2 pr-2.5 pl-3.5 shadow-panel max-[430px]:min-h-12 max-[430px]:pr-3 max-[430px]:pl-3">
              <div className="min-w-0">
                <p className="min-w-0 truncate text-[15px] font-bold">
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
        <section className="relative">
          {mode === "mobile" ? (
            <>
              <Button
                variant="outline"
                size="icon"
                aria-label="打开章节目录"
                aria-expanded={mobileChapterRailOpen}
                className="fixed left-2 top-[76px] z-30 h-11 w-11 shadow-panel"
                onClick={() => setMobileChapterRailOpen(true)}
              >
                <PanelLeftOpen size={20} />
              </Button>
              {mobileChapterRailOpen ? (
                <div className="fixed inset-0 z-50" role="presentation">
                  <button
                    type="button"
                    aria-label="关闭章节目录"
                    className="absolute inset-0 bg-black/35"
                    onClick={() => setMobileChapterRailOpen(false)}
                  />
                  <div
                    className="absolute inset-y-0 left-0 w-[min(84vw,340px)] border-r border-border bg-white p-2 pt-[calc(12px+env(safe-area-inset-top))] shadow-2xl"
                    role="dialog"
                    aria-label="章节目录"
                    aria-modal="true"
                  >
                    <div className="mb-2 flex items-center justify-between px-1">
                      <strong className="text-sm">章节目录</strong>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="关闭章节目录"
                        onClick={() => setMobileChapterRailOpen(false)}
                      >
                        <X size={18} />
                      </Button>
                    </div>
                    <ChapterRail
                      chapters={chapters}
                      currentIndex={activeIndex}
                      onSelect={(index) => {
                        setChapterIndex(index);
                        setMobileChapterRailOpen(false);
                      }}
                      className="static max-h-[calc(100vh-78px)] rounded-md shadow-none"
                    />
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
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
      {coverageOpen && (
        <ChapterCoverageDialog
          chapters={coverageChapters}
          onClose={() => setCoverageOpen(false)}
        />
      )}
      <Dialog
        open={addChapterOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAddChapterOpen(false);
            setAddChapterTitle("");
            setAddChapterText("");
          }
        }}
        title="添加章节"
        description="用于番外、作者说、短章等手动补充的内容。"
        className="max-w-2xl"
      >
        <div className="space-y-3">
          <label
            className="block text-xs font-medium"
            htmlFor="add-chapter-title"
          >
            章节标题
          </label>
          <input
            id="add-chapter-title"
            className="w-full rounded-md border px-3 py-2 text-sm"
            value={addChapterTitle}
            onChange={(event) => setAddChapterTitle(event.target.value)}
            placeholder="例如：番外 · 雨季来信"
          />
          <label
            className="block text-xs font-medium"
            htmlFor="add-chapter-text"
          >
            正文（最多 {MAX_CHAPTER_LENGTH.toLocaleString()} 字）
          </label>
          <textarea
            id="add-chapter-text"
            className="h-40 w-full rounded-md border px-3 py-2 text-sm"
            value={addChapterText}
            maxLength={MAX_CHAPTER_LENGTH}
            onChange={(event) => setAddChapterText(event.target.value)}
            placeholder="粘贴或输入章节内容…"
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAddChapterOpen(false)}
            >
              取消
            </Button>
            <Button size="sm" onClick={addChapter}>
              添加并编辑
            </Button>
          </div>
        </div>
      </Dialog>
      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          if (!open) {
            setUploadOpen(false);
            setUploadDiff(null);
          }
        }}
        title="确定并分章上传"
        description="每个章节作为一个独立内容上传到服务器。"
        className="max-w-2xl"
      >
        {uploadDiff ? (
          <div className="space-y-3">
            {uploadDiff.gaps > 0 ? (
              <div className="rounded-md border border-[#f0b4b0] bg-[#fdf1f0] px-3 py-2 text-xs text-[#8f2b24]">
                ⚠ 本地核对发现仍有 <strong>{uploadDiff.gaps}</strong>{" "}
                段文字未切分进任何章节，
                建议先在上方原文对照列核对并处理，再上传。
              </div>
            ) : (
              <div className="rounded-md border border-[#add4cb] bg-[#edf8f5] px-3 py-2 text-xs text-[#185f57]">
                ✓ 本地核对通过：全部原文已连续切分进章节，无未切分段落。
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              将分章上传 <strong>{uploadDiff.total}</strong> 个章节（新增{" "}
              {uploadDiff.added}，修改 {uploadDiff.modified}）。未变化的章节
              不会重复上传。
            </p>
            <div className="max-h-64 overflow-auto rounded-md border p-2">
              {uploadDiff.rows.map((row, index) => (
                <div
                  key={row.id || index}
                  className="flex items-center justify-between gap-2 border-b py-1 text-xs last:border-b-0"
                >
                  <span className="truncate">
                    {index + 1}. {row.title}
                  </span>
                  <span
                    className={
                      row.status === "未变化"
                        ? "text-muted-foreground"
                        : "text-[#176e66]"
                    }
                  >
                    {row.status}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={uploading}
                onClick={() => {
                  setUploadOpen(false);
                  setUploadDiff(null);
                }}
              >
                取消
              </Button>
              <Button
                size="sm"
                disabled={uploading}
                onClick={() => void confirmUpload()}
              >
                {uploading ? "上传中…" : "确认分章上传"}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </main>
  );
}
