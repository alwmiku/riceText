import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  listForumChapters,
  syncLongTextChapters,
  uploadLongTextChapter,
} from "../../lib/api";
import {
  deleteLongTextValue,
  loadLongTextValue,
  saveLongTextValue,
} from "../../lib/long-text-draft-storage";
import type { RichTextNode } from "../../lib/types";
import { sha256Hex } from "../../lib/utils";
import { longTextChapterId } from "../editor/long-text/long-text-ids";
import { collectRawGaps } from "../novel/raw-coverage";
import type { CoverageChapter } from "../novel/ChapterCoverageDialog";
import type {
  ChapterUploadDiff,
  ChapterUploadRow,
} from "../novel/ChapterUploadDialog";

interface PreparedChapter extends ChapterUploadRow {
  order: number;
  content: RichTextNode;
  hash: string;
  baseRevision: number;
}

interface UploadCheckpoint {
  version: 1;
  novelId: string;
  gaps: number;
  sourceHash: string;
  stale: boolean;
  chapters: PreparedChapter[];
}

interface ChapterUploadOptions {
  novelId: string;
  getDocument: () => RichTextNode;
  getCoverage: () => readonly CoverageChapter[];
  onNotice: (notice: string) => void;
}

const checkpointKey = (novelId: string) =>
  `ricetext:long-text-upload:${novelId}`;

function isBlockingUploadError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 409 ||
      error.code === "CHAPTER_REVISION_CONFLICT" ||
      error.code === "CHAPTER_ID_CONFLICT" ||
      error.code === "CHAPTER_ORDER_CONFLICT")
  );
}

function toDiff(checkpoint: UploadCheckpoint): ChapterUploadDiff {
  const rows = checkpoint.chapters.map(
    ({ id, title, action, status, attempts, error, retryable }) => ({
      id,
      title,
      action,
      status,
      attempts,
      ...(error ? { error } : {}),
      ...(retryable === false ? { retryable } : {}),
    }),
  );
  return {
    total: rows.length,
    toUpdate: rows.filter((row) => row.action !== "未变化").length,
    added: rows.filter((row) => row.action === "新增").length,
    modified: rows.filter((row) => row.action === "修改").length,
    uploaded: rows.filter((row) => row.status === "已上传").length,
    gaps: checkpoint.gaps,
    stale: checkpoint.stale,
    rows,
  };
}

/** 管理按文章隔离、可持久化并可逐章续传的上传计划。 */
export function useChapterUpload({
  novelId,
  getDocument,
  getCoverage,
  onNotice,
}: ChapterUploadOptions) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [diff, setDiff] = useState<ChapterUploadDiff | null>(null);
  const [hasCheckpoint, setHasCheckpoint] = useState(false);
  const checkpointRef = useRef<UploadCheckpoint | null>(null);
  const novelIdRef = useRef(novelId);
  novelIdRef.current = novelId;
  const operationRef = useRef(0);
  const runnerRef = useRef(false);
  const getDocumentRef = useRef(getDocument);
  const getCoverageRef = useRef(getCoverage);
  const onNoticeRef = useRef(onNotice);
  getDocumentRef.current = getDocument;
  getCoverageRef.current = getCoverage;
  onNoticeRef.current = onNotice;

  const publishCheckpoint = useCallback((checkpoint: UploadCheckpoint) => {
    if (checkpoint.novelId !== novelIdRef.current) return;
    checkpointRef.current = checkpoint;
    setDiff(toDiff(checkpoint));
  }, []);

  useEffect(() => {
    const operation = ++operationRef.current;
    runnerRef.current = false;
    setOpen(false);
    setPreparing(false);
    setUploading(false);
    setDiff(null);
    setHasCheckpoint(false);
    checkpointRef.current = null;

    void loadLongTextValue<UploadCheckpoint>(checkpointKey(novelId))
      .then((stored) => {
        if (operation !== operationRef.current || !stored || stored.novelId !== novelId)
          return;
        const restored: UploadCheckpoint = {
          ...stored,
          chapters: stored.chapters.map((chapter) => ({
            ...chapter,
            status:
              chapter.status === "上传中" ||
              (chapter.status === "失败" && chapter.retryable !== false)
                ? "待上传"
                : chapter.status,
          })),
        };
        const unfinished = restored.chapters.some(
          (chapter) => chapter.status !== "已上传" && chapter.status !== "未变化",
        );
        if (!unfinished) {
          void deleteLongTextValue(checkpointKey(novelId));
          return;
        }
        publishCheckpoint(restored);
        setHasCheckpoint(true);
      })
      .catch(() => undefined);

    return () => {
      operationRef.current += 1;
      runnerRef.current = false;
    };
  }, [novelId, publishCheckpoint]);

  const cancel = useCallback(() => {
    if (uploading) return;
    operationRef.current += 1;
    setOpen(false);
    setPreparing(false);
  }, [uploading]);

  const resume = useCallback(() => {
    if (!checkpointRef.current) return;
    setOpen(true);
  }, []);

  const prepare = useCallback(async () => {
    const document = getDocumentRef.current();
    const nodes = document.content ?? [];
    if (nodes.length === 0) {
      onNoticeRef.current("当前没有可上传的章节");
      return;
    }
    const operation = ++operationRef.current;
    const capturedNovelId = novelId;
    setPreparing(true);
    try {
      const sourceHash = await sha256Hex(JSON.stringify(document));
      if (operation !== operationRef.current) return;
      const directory = await listForumChapters(capturedNovelId, { strict: true });
      if (operation !== operationRef.current) return;
      const directoryById = new Map(directory.map((chapter) => [chapter.id, chapter]));
      const directoryByOrder = new Map(
        directory.map((chapter) => [chapter.order, chapter]),
      );
      const chapters = await Promise.all(
        nodes.map(async (node, order): Promise<PreparedChapter> => {
          const rawId = String(node.attrs?.chapterId ?? `chapter-${order}`);
          const scopedId = longTextChapterId(capturedNovelId, rawId);
          const id = directoryById.has(rawId)
            ? rawId
            : directoryById.has(scopedId)
              ? scopedId
              : (directoryByOrder.get(order)?.id ?? scopedId);
          const title = String(node.attrs?.title ?? "未命名章节");
          const normalizedNode: RichTextNode = {
            ...node,
            attrs: { ...node.attrs, chapterId: id, order },
          };
          const content: RichTextNode = { type: "doc", content: [normalizedNode] };
          const hash = await sha256Hex(JSON.stringify({ title, order, content }));
          return {
            id,
            title,
            order,
            content,
            hash,
            baseRevision: directoryById.get(id)?.revision ?? 0,
            action: "未变化",
            status: "未变化",
            attempts: 0,
          };
        }),
      );
      if (operation !== operationRef.current) return;
      const sync = await syncLongTextChapters(
        capturedNovelId,
        chapters.map(({ id, title, order, hash }) => ({ id, title, order, hash })),
      );
      if (operation !== operationRef.current) return;
      const toUpdate = new Set(sync.toUpdate);
      const existing = new Set(sync.existing);
      const checkpoint: UploadCheckpoint = {
        version: 1,
        novelId: capturedNovelId,
        gaps: collectRawGaps(getCoverageRef.current()).length,
        sourceHash,
        stale: false,
        chapters: chapters.map((chapter) => ({
          ...chapter,
          action: !toUpdate.has(chapter.id)
            ? "未变化"
            : existing.has(chapter.id)
              ? "修改"
              : "新增",
          status: toUpdate.has(chapter.id) ? "待上传" : "未变化",
        })),
      };
      publishCheckpoint(checkpoint);
      setHasCheckpoint(checkpoint.chapters.some((chapter) => chapter.status === "待上传"));
      await saveLongTextValue(checkpointKey(capturedNovelId), checkpoint);
      if (operation === operationRef.current) setOpen(true);
    } catch (error) {
      if (operation !== operationRef.current) return;
      checkpointRef.current = null;
      setDiff(null);
      setHasCheckpoint(false);
      onNoticeRef.current(
        error instanceof Error
          ? `无法计算章节差异：${error.message}`
          : "无法计算章节差异",
      );
    } finally {
      if (operation === operationRef.current) setPreparing(false);
    }
  }, [novelId, publishCheckpoint]);

  const confirm = useCallback(async () => {
    const checkpoint = checkpointRef.current;
    if (!checkpoint || runnerRef.current) return;
    const operation = operationRef.current;
    runnerRef.current = true;
    setUploading(true);
    let uploadedThisRun = 0;
    try {
      const currentSourceHash = await sha256Hex(
        JSON.stringify(getDocumentRef.current()),
      );
      if (operation !== operationRef.current) return;
      if (currentSourceHash !== checkpoint.sourceHash) {
        checkpoint.stale = true;
        publishCheckpoint({ ...checkpoint });
        await saveLongTextValue(checkpointKey(checkpoint.novelId), checkpoint);
        setHasCheckpoint(true);
        onNoticeRef.current("准备上传后正文已有修改，请重新检查差异");
        return;
      }
      const tracked = checkpoint.chapters.filter(
        (chapter) => chapter.action !== "未变化",
      );
      const [directory, sync] = await Promise.all([
        listForumChapters(checkpoint.novelId, { strict: true }),
        syncLongTextChapters(
          checkpoint.novelId,
          tracked.map(({ id, title, order, hash }) => ({ id, title, order, hash })),
        ),
      ]);
      if (operation !== operationRef.current) return;
      const revisionById = new Map(
        directory.map((chapter) => [chapter.id, chapter.revision]),
      );
      const toUpdate = new Set(sync.toUpdate);
      for (const chapter of tracked) {
        if (!toUpdate.has(chapter.id)) {
          chapter.status = "已上传";
          chapter.baseRevision = revisionById.get(chapter.id) ?? chapter.baseRevision;
          delete chapter.error;
          delete chapter.retryable;
        } else if (chapter.retryable !== false) {
          chapter.status = "待上传";
          chapter.baseRevision = revisionById.get(chapter.id) ?? 0;
        }
      }
      publishCheckpoint({ ...checkpoint, chapters: [...checkpoint.chapters] });
      await saveLongTextValue(checkpointKey(checkpoint.novelId), checkpoint);

      const pending = checkpoint.chapters.filter(
        (chapter) => chapter.status === "待上传",
      );
      const blocked = checkpoint.chapters.some(
        (chapter) => chapter.status === "失败" && chapter.retryable === false,
      );
      if (pending.length === 0) {
        if (blocked) {
          setHasCheckpoint(true);
          onNoticeRef.current("上传计划存在版本或结构冲突，请重新检查差异");
          return;
        }
        setOpen(false);
        setHasCheckpoint(false);
        await deleteLongTextValue(checkpointKey(checkpoint.novelId));
        onNoticeRef.current("服务器章节已是最新版本，无需重复上传");
        return;
      }
      const directoryById = new Map(directory.map((chapter) => [chapter.id, chapter]));
      const maxServerOrder = Math.max(
        -1,
        ...directory.map((chapter) => chapter.order),
      );
      const moving = pending.filter((chapter) => {
        const remote = directoryById.get(chapter.id);
        return remote && remote.order !== chapter.order;
      });
      for (const [index, chapter] of moving.entries()) {
        const temporaryOrder = maxServerOrder + index + 1;
        const node = chapter.content.content?.[0];
        const temporaryContent: RichTextNode = node
          ? {
              type: "doc",
              content: [
                { ...node, attrs: { ...node.attrs, order: temporaryOrder } },
              ],
            }
          : chapter.content;
        chapter.status = "上传中";
        publishCheckpoint({ ...checkpoint, chapters: [...checkpoint.chapters] });
        try {
          const stagedHash = await sha256Hex(
            JSON.stringify({
              title: chapter.title,
              order: temporaryOrder,
              content: temporaryContent,
            }),
          );
          const staged = await uploadLongTextChapter(
            checkpoint.novelId,
            chapter.id,
            {
              title: chapter.title,
              order: temporaryOrder,
              content: temporaryContent,
              hash: stagedHash,
              baseRevision: revisionById.get(chapter.id) ?? chapter.baseRevision,
            },
          );
          revisionById.set(chapter.id, staged.revision);
          chapter.baseRevision = staged.revision;
          chapter.status = "待上传";
          await saveLongTextValue(checkpointKey(checkpoint.novelId), checkpoint);
        } catch (error) {
          const blocking = isBlockingUploadError(error);
          chapter.status = "失败";
          chapter.error = error instanceof Error ? error.message : "章节换序暂存失败";
          chapter.retryable = !blocking;
          publishCheckpoint({ ...checkpoint, chapters: [...checkpoint.chapters] });
          await saveLongTextValue(checkpointKey(checkpoint.novelId), checkpoint);
          setHasCheckpoint(true);
          onNoticeRef.current(
            blocking
              ? `“${chapter.title}”换序时发生冲突，请重新检查差异`
              : `“${chapter.title}”换序暂存中断，可点击继续上传重试`,
          );
          return;
        }
      }

      for (const chapter of checkpoint.chapters) {
        if (
          chapter.status !== "待上传" &&
          !(chapter.status === "失败" && chapter.retryable !== false)
        )
          continue;
        chapter.status = "上传中";
        chapter.attempts += 1;
        delete chapter.error;
        publishCheckpoint({ ...checkpoint, chapters: [...checkpoint.chapters] });
        try {
          await uploadLongTextChapter(checkpoint.novelId, chapter.id, {
            title: chapter.title,
            order: chapter.order,
            content: chapter.content,
            hash: chapter.hash,
            baseRevision: revisionById.get(chapter.id) ?? chapter.baseRevision,
          });
          chapter.status = "已上传";
          uploadedThisRun += 1;
          publishCheckpoint({ ...checkpoint, chapters: [...checkpoint.chapters] });
          await saveLongTextValue(checkpointKey(checkpoint.novelId), checkpoint);
        } catch (error) {
          const blocking = isBlockingUploadError(error);
          chapter.status = "失败";
          chapter.error = error instanceof Error ? error.message : "上传失败";
          chapter.retryable = !blocking;
          publishCheckpoint({ ...checkpoint, chapters: [...checkpoint.chapters] });
          await saveLongTextValue(checkpointKey(checkpoint.novelId), checkpoint);
          setHasCheckpoint(true);
          onNoticeRef.current(
            blocking
              ? `“${chapter.title}”存在版本或结构冲突，请重新检查差异`
              : `已上传 ${uploadedThisRun} 章，在“${chapter.title}”处暂停；可点击继续上传重试`,
          );
          return;
        }
      }

      const stillBlocked = checkpoint.chapters.some(
        (chapter) => chapter.status === "失败" && chapter.retryable === false,
      );
      if (stillBlocked) {
        setHasCheckpoint(true);
        await saveLongTextValue(checkpointKey(checkpoint.novelId), checkpoint);
        onNoticeRef.current(
          `已上传 ${uploadedThisRun} 章，其余冲突章节需要重新检查差异`,
        );
        return;
      }
      setHasCheckpoint(false);
      await deleteLongTextValue(checkpointKey(checkpoint.novelId));
      onNoticeRef.current(`已分章上传 ${uploadedThisRun} 章`);
      void queryClient.invalidateQueries({
        queryKey: ["forum", "chapters", checkpoint.novelId],
      });
    } catch (error) {
      setHasCheckpoint(true);
      onNoticeRef.current(
        error instanceof Error
          ? `无法恢复上传进度：${error.message}`
          : "无法恢复上传进度，请稍后重试",
      );
    } finally {
      runnerRef.current = false;
      if (operation === operationRef.current) setUploading(false);
    }
  }, [publishCheckpoint, queryClient]);

  return {
    open,
    diff,
    preparing,
    uploading,
    hasCheckpoint,
    prepare,
    resume,
    confirm,
    cancel,
  };
}
