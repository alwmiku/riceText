import {
  MAX_CHAPTER_LENGTH,
  type ChapterTitleStyle,
} from "@ricetext/editor-core";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { RichTextNode } from "../../lib/types";
import {
  deleteLongTextValue,
  loadLongTextDraft,
  loadLongTextRaw,
  saveLongTextDraft,
  saveLongTextRaw,
} from "../../lib/long-text-draft-storage";
import { createLongTextDocument } from "../editor/long-text/long-text-import";
import {
  createLongTextChapterIdInDocument,
  migrateLongTextChapterIds,
} from "../editor/long-text/long-text-ids";
import {
  appendGapLongTextChapter,
  appendLongTextChapter,
  deleteLongTextChapter,
  mergeLongTextChapter,
  moveLongTextChapter,
  splitLongTextChapter,
} from "../editor/long-text/long-text-chapter-operations";
import {
  activeLongTextChapter,
  mapLongTextCoverage,
  summarizeLongTextChapters,
} from "./long-text-workspace-projections";
import { useLongTextDraftPersistence } from "./useLongTextDraftPersistence";
import { useLongTextEditorBuffer } from "./useLongTextEditorBuffer";

const longTextDraftKey = (documentId: string) =>
  `ricetext:local-long-text:${documentId}`;
const longTextRawKey = (documentId: string) =>
  `ricetext:local-long-text-raw:${documentId}`;

interface LongTextWorkspaceOptions {
  documentId: string;
  content: RichTextNode;
  contentRef: MutableRefObject<RichTextNode>;
  replaceContent: (next: RichTextNode) => void;
  setAutosaveEnabled: (enabled: boolean) => void;
  setNotice: (notice: string) => void;
}

/** 长文本领域编排：管理模式切换、草稿恢复、章节命令和原文覆盖率。 */
export function useLongTextWorkspace({
  documentId,
  content,
  contentRef,
  replaceContent,
  setAutosaveEnabled,
  setNotice,
}: LongTextWorkspaceOptions) {
  // React state 驱动界面；ref 为异步流程和防抖回调提供同步的当前值。
  const [enabled, setEnabled] = useState(false);
  const [hasLocalDraft, setHasLocalDraft] = useState(false);
  const [hasStoredDraft, setHasStoredDraft] = useState(false);
  const [documentVersion, setDocumentVersion] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [chapterTitleStyle, setChapterTitleStyle] =
    useState<ChapterTitleStyle>("auto");
  const [rawText, setRawText] = useState<string | null>(null);
  const activeIndexRef = useRef(0);
  const normalContentRef = useRef<RichTextNode | null>(null);
  // 每次异步打开/恢复递增令牌；旧请求返回时发现令牌失效便放弃写入。
  const operationRef = useRef(0);
  const importWriteRef = useRef<Promise<void> | null>(null);
  const handleDraftError = useCallback(
    () => setNotice("本机草稿自动保存失败，请检查浏览器存储空间"),
    [setNotice],
  );
  const {
    markChanged,
    suspend: suspendDraft,
    resume: resumeDraft,
    acceptCurrent: acceptCurrentDraft,
    saveNow: saveDraftNow,
  } = useLongTextDraftPersistence({
    enabled,
    draftKey: longTextDraftKey(documentId),
    contentRef,
    onError: handleDraftError,
  });
  const skipNextCloseSaveRef = useRef(false);
  const markWorkspaceChanged = useCallback(() => {
    skipNextCloseSaveRef.current = false;
    markChanged();
  }, [markChanged]);
  const {
    flush: flushEdits,
    updateEditor,
    editChapter,
  } = useLongTextEditorBuffer({
    contentRef,
    activeIndexRef,
    replaceContent,
    onChanged: markWorkspaceChanged,
  });

  // 结构变化递增 documentVersion，强制单章编辑器按新的章节边界重建。
  const replaceLongTextDocument = useCallback(
    (next: RichTextNode) => {
      replaceContent(next);
      setDocumentVersion((version) => version + 1);
      markWorkspaceChanged();
    },
    [markWorkspaceChanged, replaceContent],
  );

  const chapterSummaries = useMemo(
    () => (enabled ? summarizeLongTextChapters(content) : []),
    [content, enabled],
  );
  const coverageChapters = useMemo(
    () => (enabled ? mapLongTextCoverage(content, rawText) : []),
    [content, enabled, rawText],
  );
  const editorContent = useMemo(
    () =>
      enabled
        ? activeLongTextChapter(content, activeIndex)
        : { type: "doc", content: [] },
    [activeIndex, content, enabled],
  );

  const open = useCallback(async () => {
    // 普通正文先暂存；长文本使用独立内存文档并停用服务器 autosave。
    const operation = ++operationRef.current;
    normalContentRef.current = contentRef.current;
    skipNextCloseSaveRef.current = false;
    suspendDraft();
    acceptCurrentDraft();
    activeIndexRef.current = 0;
    setActiveIndex(0);
    setHasLocalDraft(false);
    setHasStoredDraft(false);
    setAutosaveEnabled(false);
    setEnabled(true);
    replaceContent({ type: "doc", content: [] });
    setDocumentVersion((version) => version + 1);
    try {
      const [raw, stored] = await Promise.all([
        loadLongTextRaw(longTextRawKey(documentId)),
        loadLongTextDraft(longTextDraftKey(documentId)),
      ]);
      if (operation !== operationRef.current) return;
      setRawText(raw ?? null);
      setHasStoredDraft(Boolean(stored));
      if (stored && (stored.content ?? []).length > 0) {
        setHasLocalDraft(true);
        setNotice("检测到本机草稿，可点击“恢复本机草稿”");
      } else {
        setNotice("长文本工作台已就绪，可导入 .txt 或开始写作");
      }
    } catch {
      if (operation === operationRef.current)
        setNotice("无法读取本机草稿，已打开空白长文本工作台");
    } finally {
      if (operation === operationRef.current) resumeDraft();
    }
  }, [
    acceptCurrentDraft,
    contentRef,
    documentId,
    replaceContent,
    resumeDraft,
    setAutosaveEnabled,
    setNotice,
    suspendDraft,
  ]);

  const close = useCallback(async () => {
    // 切换视图前先持久化最后一次缓冲编辑，再恢复普通正文。
    operationRef.current += 1;
    const pendingImport = importWriteRef.current;
    flushEdits();
    suspendDraft();
    try {
      if (pendingImport) await pendingImport;
      else if (!skipNextCloseSaveRef.current) await saveDraftNow();
      if (pendingImport || !skipNextCloseSaveRef.current) setHasStoredDraft(true);
    } catch {
      handleDraftError();
      resumeDraft();
      return false;
    }
    skipNextCloseSaveRef.current = false;
    const normalContent = normalContentRef.current;
    normalContentRef.current = null;
    if (normalContent) replaceContent(normalContent);
    setEnabled(false);
    setAutosaveEnabled(true);
    return true;
  }, [
    flushEdits,
    handleDraftError,
    replaceContent,
    resumeDraft,
    saveDraftNow,
    setAutosaveEnabled,
    suspendDraft,
  ]);

  const restoreDraft = useCallback(async () => {
    const operation = ++operationRef.current;
    suspendDraft();
    try {
      const [raw, stored] = await Promise.all([
        loadLongTextRaw(longTextRawKey(documentId)),
        loadLongTextDraft(longTextDraftKey(documentId)),
      ]);
      if (operation !== operationRef.current) return;
      setRawText(raw ?? null);
      if (!stored) {
        setHasLocalDraft(false);
        setNotice("没有可恢复的本机草稿");
        return;
      }
      activeIndexRef.current = 0;
      setActiveIndex(0);
      const migrated = await migrateLongTextChapterIds(stored);
      if (operation !== operationRef.current) return;
      if (JSON.stringify(migrated) !== JSON.stringify(stored)) {
        await saveLongTextDraft(longTextDraftKey(documentId), migrated);
      }
      replaceContent(migrated);
      setDocumentVersion((version) => version + 1);
      setHasLocalDraft(false);
      setHasStoredDraft(true);
      setNotice("已恢复本机草稿");
    } catch {
      if (operation === operationRef.current)
        setNotice("无法读取本机草稿，请检查浏览器存储");
    } finally {
      if (operation === operationRef.current) resumeDraft();
    }
  }, [documentId, replaceContent, resumeDraft, setNotice, suspendDraft]);

  const importFile = useCallback(
    async (file: File) => {
      const operation = ++operationRef.current;
      const capturedDocumentId = documentId;
      try {
        const text = await file.text();
        if (operation !== operationRef.current) return;
        if (!text.trim()) {
          setNotice("未导入空白文本");
          return;
        }
        const imported = await createLongTextDocument(
          text,
          capturedDocumentId,
          chapterTitleStyle,
        );
        suspendDraft();
        const writes = Promise.all([
          saveLongTextRaw(longTextRawKey(capturedDocumentId), text),
          saveLongTextDraft(longTextDraftKey(capturedDocumentId), imported),
        ]).then(() => undefined);
        importWriteRef.current = writes;
        try {
          await writes;
        } finally {
          if (importWriteRef.current === writes) importWriteRef.current = null;
        }
        if (operation !== operationRef.current) return;
        acceptCurrentDraft();
        resumeDraft();
        setHasLocalDraft(false);
        setHasStoredDraft(true);
        activeIndexRef.current = 0;
        setActiveIndex(0);
        setRawText(text);
        replaceLongTextDocument(imported);
        setEnabled(true);
        setNotice(`已导入 ${file.name}，共 ${text.length.toLocaleString()} 字`);
      } catch (error) {
        resumeDraft();
        setNotice(error instanceof Error ? error.message : "文本导入失败");
      }
    },
    [
      acceptCurrentDraft,
      chapterTitleStyle,
      documentId,
      replaceLongTextDocument,
      resumeDraft,
      setNotice,
      suspendDraft,
    ],
  );

  const saveDraft = useCallback(async () => {
    flushEdits();
    try {
      await saveDraftNow();
      setHasLocalDraft(false);
      setHasStoredDraft(true);
      setNotice("长文本已保存在本机；上传时将按章节分别提交");
      return true;
    } catch {
      setNotice("本机草稿保存失败，请检查浏览器存储空间");
      return false;
    }
  }, [flushEdits, saveDraftNow, setNotice]);

  const clearDraft = useCallback(async () => {
    operationRef.current += 1;
    suspendDraft();
    try {
      await Promise.all([
        deleteLongTextValue(longTextDraftKey(documentId)),
        deleteLongTextValue(longTextRawKey(documentId)),
      ]);
      setHasLocalDraft(false);
      setHasStoredDraft(false);
      setRawText(null);
      skipNextCloseSaveRef.current = true;
      acceptCurrentDraft();
      setNotice("已清除当前文章的本机长文本草稿和原文快照");
      return true;
    } catch {
      setNotice("清除本机长文本草稿失败，请检查浏览器存储");
      return false;
    } finally {
      if (enabled) resumeDraft();
    }
  }, [
    acceptCurrentDraft,
    documentId,
    enabled,
    resumeDraft,
    setNotice,
    suspendDraft,
  ]);

  const selectChapter = useCallback(
    (index: number) => {
      if (index === activeIndexRef.current) return;
      flushEdits();
      activeIndexRef.current = index;
      setActiveIndex(index);
      setDocumentVersion((version) => version + 1);
    },
    [flushEdits],
  );

  // 所有纯章节操作都经此处同步文档、活动索引和编辑器版本。
  const applyOperation = useCallback(
    (result: { document: RichTextNode; activeIndex: number } | null) => {
      if (!result) return false;
      activeIndexRef.current = result.activeIndex;
      replaceLongTextDocument(result.document);
      setActiveIndex(result.activeIndex);
      return true;
    },
    [replaceLongTextDocument],
  );

  const deleteChapter = useCallback(
    (index: number) => {
      flushEdits();
      applyOperation(
        deleteLongTextChapter(
          contentRef.current,
          index,
          activeIndexRef.current,
        ),
      );
    },
    [applyOperation, contentRef, flushEdits],
  );

  const mergeChapter = useCallback(
    (index: number) => {
      flushEdits();
      applyOperation(mergeLongTextChapter(contentRef.current, index));
    },
    [applyOperation, contentRef, flushEdits],
  );

  const moveChapter = useCallback(
    (from: number, to: number) => {
      flushEdits();
      applyOperation(moveLongTextChapter(contentRef.current, from, to));
    },
    [applyOperation, contentRef, flushEdits],
  );

  const addChapter = useCallback(
    async (titleInput: string, textInput: string) => {
      const title = titleInput.trim();
      const text = textInput.slice(0, MAX_CHAPTER_LENGTH);
      if (!title && !text) return false;
      flushEdits();
      const snapshot = contentRef.current;
      const chapterTitle = title || "未命名章节";
      const chapterId = await createLongTextChapterIdInDocument(
        snapshot,
        chapterTitle,
        text,
      );
      applyOperation(
        appendLongTextChapter(snapshot, {
          chapterId,
          title: chapterTitle,
          text,
        }),
      );
      setNotice(`已添加章节“${chapterTitle}”`);
      return true;
    },
    [applyOperation, contentRef, flushEdits, setNotice],
  );

  const createChapterFromGap = useCallback(
    async (text: string, start: number, end: number) => {
      if (!text.trim()) return;
      flushEdits();
      const snapshot = contentRef.current;
      const chapterId = await createLongTextChapterIdInDocument(
        snapshot,
        "未命名章节",
        text,
      );
      if (
        applyOperation(
          appendGapLongTextChapter(snapshot, {
            chapterId,
            text,
            start,
            end,
          }),
        )
      ) {
        setNotice("已把未切分段落创建为新章节，请补充标题并核对内容");
      }
    },
    [applyOperation, contentRef, flushEdits, setNotice],
  );

  const splitChapter = useCallback(
    async (before: string, after: string) => {
      flushEdits();
      const index = activeIndexRef.current;
      const snapshot = contentRef.current;
      const current = snapshot.content?.[index];
      const splitTitle = `第 ${index + 2} 章`;
      const chapterId = await createLongTextChapterIdInDocument(
        snapshot,
        splitTitle,
        after,
      );
      if (
        current &&
        applyOperation(
          splitLongTextChapter(snapshot, index, {
            chapterId,
            before,
            after,
          }),
        )
      ) {
        setNotice(
          `已在光标处拆分为“${String(current.attrs?.title ?? "当前章")}”与“第 ${index + 2} 章”`,
        );
      }
    },
    [applyOperation, contentRef, flushEdits, setNotice],
  );

  return {
    enabled,
    hasLocalDraft,
    hasStoredDraft,
    documentVersion,
    activeIndex,
    chapterTitleStyle,
    rawText,
    chapterSummaries,
    coverageChapters,
    editorContent,
    setChapterTitleStyle,
    getBaseContent: () =>
      normalContentRef.current ?? { type: "doc", content: [{ type: "paragraph" }] },
    open,
    close,
    restoreDraft,
    importFile,
    saveDraft,
    clearDraft,
    flushEdits,
    updateEditor,
    selectChapter,
    deleteChapter,
    mergeChapter,
    moveChapter,
    addChapter,
    createChapterFromGap,
    splitChapter,
    editChapter,
  };
}
