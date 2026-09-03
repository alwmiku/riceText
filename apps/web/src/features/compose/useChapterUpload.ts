import { convertLongTextBlocksToChapters } from "@ricetext/document-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  listForumChapters,
  stageLongTextChapterReorder,
  syncLongTextChapters,
  uploadLongTextChaptersBatch,
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
  ChapterUploadAction,
  ChapterUploadDiff,
  ChapterUploadRow,
  ChapterUploadStatus,
} from "../novel/ChapterUploadDialog";
import {
  backoffDelay,
  bisectBatch,
  isBlockingBatchError,
  isRetryableBatchError,
  isTooLargeBatchError,
  MAX_BATCH_RETRIES,
  MAX_CHAPTER_CONTENT_BYTES,
  MAX_REORDER_PER_BATCH,
  splitByCount,
  splitUploadBatches,
  utf8ByteLength,
  type StageChapterReorderItem,
  type UploadBatchChapterItem,
} from "./chapter-upload-batches";

/** v2 检查点只保存元数据，正文以本地长文本草稿为唯一来源。 */
interface UploadCheckpointChapter extends ChapterUploadRow {
  order: number;
  hash: string;
  baseRevision: number;
}

interface UploadCheckpointV2 {
  version: 2;
  novelId: string;
  gaps: number;
  /** 换序阶段：staging = 移动章节尚未全部暂存；content = 已可发送正文批次。 */
  reorderPhase: "staging" | "content";
  /** id -> 全局唯一临时 order；从首个运行开始稳定，跨刷新保持不变。 */
  temporaryOrders: Record<string, number>;
  chapters: UploadCheckpointChapter[];
}

interface ChapterUploadOptions {
  novelId: string;
  getDocument: () => RichTextNode;
  getCoverage: () => readonly CoverageChapter[];
  ensureDocument?: () => Promise<boolean>;
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

/** 与 prepare 阶段一致的章节 id 解析：目录已有 id > 作用域 id > 按顺序取目录行。 */
function resolveChapterId(
  node: RichTextNode,
  order: number,
  directoryById: ReadonlyMap<string, { id: string }>,
  directoryByOrder: ReadonlyMap<number, { id: string }>,
  novelId: string,
): string {
  const rawId = String(node.attrs?.chapterId ?? `chapter-${order}`);
  const scopedId = longTextChapterId(novelId, rawId);
  return directoryById.has(rawId)
    ? rawId
    : directoryById.has(scopedId)
      ? scopedId
      : (directoryByOrder.get(order)?.id ?? scopedId);
}

/** 服务器章节目录行（buildCheckpoint 使用的最小投影）。 */
interface DirectoryChapter {
  id: string;
  order: number;
  revision: number;
}

/**
 * 基于当前文档快照与服务器目录构建上传计划：按章节 id + 正文 hash 与服务器
 * 目录对比，服务器已有相同 id/hash 的章节标记为无需上传（id 有了就不传），
 * 其余（id 不存在或 hash 不同）进入待上传队列。同时返回转换后的章节目录到
 * 正文的映射，供确认上传时直接组成批请求（正文只在此处转换一次）。
 */
async function buildCheckpoint(
  capturedNovelId: string,
  document: RichTextNode,
  directory: readonly DirectoryChapter[],
  gaps: number,
): Promise<{
  checkpoint: UploadCheckpointV2;
  contentByChapter: Map<
    string,
    { content: RichTextNode; hash: string; baseRevision: number }
  >;
}> {
  const directoryById = new Map(
    directory.map((chapter) => [chapter.id, chapter]),
  );
  const directoryByOrder = new Map(
    directory.map((chapter) => [chapter.order, chapter]),
  );
  const nodes = document.content ?? [];
  const chapters: UploadCheckpointChapter[] = [];
  const contentByChapter = new Map<
    string,
    { content: RichTextNode; hash: string; baseRevision: number }
  >();
  // 分块转换 + 周期性让出主线程：几千章准备阶段仍然保持页面响应。
  for (let offset = 0; offset < nodes.length; offset += 64) {
    const converted = await Promise.all(
      nodes.slice(offset, offset + 64).map(
        async (node, order): Promise<UploadCheckpointChapter> => {
          const id = resolveChapterId(
            node,
            order,
            directoryById,
            directoryByOrder,
            capturedNovelId,
          );
          const title = String(node.attrs?.title ?? "未命名章节");
          const normalizedNode: RichTextNode = {
            ...node,
            attrs: { ...node.attrs, chapterId: id, order },
          };
          const content = convertLongTextBlocksToChapters({
            type: "doc",
            content: [normalizedNode],
          }) as RichTextNode;
          const hash = await sha256Hex(
            JSON.stringify({ title, order, content }),
          );
          const oversized =
            utf8ByteLength(JSON.stringify(content)) > MAX_CHAPTER_CONTENT_BYTES;
          const baseRevision = directoryById.get(id)?.revision ?? 0;
          contentByChapter.set(id, { content, hash, baseRevision });
          return {
            id,
            title,
            order,
            hash,
            baseRevision,
            action: "未变化" as ChapterUploadAction,
            status: "未变化" as ChapterUploadStatus,
            attempts: 0,
            ...(oversized
              ? {
                  status: "失败" as ChapterUploadStatus,
                  retryable: false,
                  error: `单章标准化正文超过 1.8 MiB，请先拆分“${title}”`,
                }
              : {}),
          };
        },
      ),
    );
    chapters.push(...converted);
    await yieldToUI();
  }
  const sync = await syncLongTextChapters(
    capturedNovelId,
    chapters.map(({ id, title, order, hash }) => ({ id, title, order, hash })),
  );
  const toUpdate = new Set(sync.toUpdate);
  const existing = new Set(sync.existing);
  const hasMoves = chapters.some((chapter) => {
    const remote = directoryById.get(chapter.id);
    return remote && remote.order !== chapter.order;
  });
  const checkpoint: UploadCheckpointV2 = {
    version: 2,
    novelId: capturedNovelId,
    gaps,
    /** 确有换序时先进入 staging 阶段，否则直接进入正文批次。 */
    reorderPhase: hasMoves ? "staging" : "content",
    temporaryOrders: {},
    chapters: chapters.map((chapter) => ({
      ...chapter,
      action:
        chapter.status === "失败"
          ? "新增"
          : !toUpdate.has(chapter.id)
            ? "未变化"
            : existing.has(chapter.id)
              ? "修改"
              : "新增",
      status:
        chapter.status === "失败"
          ? "失败"
          : toUpdate.has(chapter.id)
            ? "待上传"
            : "未变化",
    })),
  };
  return { checkpoint, contentByChapter };
}

/**
 * v1 检查点迁移：仅转换结构并移除内嵌的重复正文。确认流程每次都会按当前
 * 正文与服务器目录重建计划，因此迁移不做任何快照校验——即使 v1 计划与
 * 当前草稿有出入，确认时自然以最新内容为准。
 */
async function migrateV1Checkpoint(
  stored: Record<string, unknown>,
  novelId: string,
): Promise<UploadCheckpointV2 | null> {
  const chapters = stored.chapters as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(chapters)) return null;
  return {
    version: 2,
    novelId,
    gaps: typeof stored.gaps === "number" ? stored.gaps : 0,
    // v1 计划可能处于换序中途；恢复时以幂等暂存重新对齐，再进入正文批次。
    reorderPhase: "staging",
    temporaryOrders: {},
    chapters: chapters.map((chapter) => {
      const status = chapter.status ?? "未变化";
      return {
        id: String(chapter.id ?? ""),
        title: String(chapter.title ?? "未命名章节"),
        order: typeof chapter.order === "number" ? chapter.order : 0,
        hash: String(chapter.hash ?? ""),
        baseRevision:
          typeof chapter.baseRevision === "number" ? chapter.baseRevision : 0,
        action: (chapter.action ?? "未变化") as ChapterUploadAction,
        status:
          status === "上传中" ||
          (status === "失败" && chapter.retryable !== false)
            ? "待上传"
            : (status as ChapterUploadStatus),
        attempts: typeof chapter.attempts === "number" ? chapter.attempts : 0,
        ...(chapter.error ? { error: String(chapter.error) } : {}),
        ...(chapter.retryable === false ? { retryable: false } : {}),
      };
    }),
  };
}

/** 恢复上传计划：上传中/可重试失败统一回到待上传。 */
function restoreCheckpoint(stored: UploadCheckpointV2): UploadCheckpointV2 {
  return {
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
}

function toDiff(
  checkpoint: UploadCheckpointV2,
  progress: { current: number | null; total: number | null },
): ChapterUploadDiff {
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
    failed: rows.filter((row) => row.status === "失败").length,
    pending: rows.filter(
      (row) => row.status === "待上传" || row.status === "上传中",
    ).length,
    gaps: checkpoint.gaps,
    batchCurrent: progress.current,
    batchTotal: progress.total,
    rows,
  };
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 让出主线程给浏览器处理渲染与输入事件，避免连续批次饿死事件循环。 */
const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type SendOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown; retryable: boolean };

/** 单请求指数退避：429/5xx/网络最多 MAX_BATCH_RETRIES 次；409/422/413 不重试。 */
async function sendWithRetry<T>(
  send: () => Promise<T>,
): Promise<SendOutcome<T>> {
  let attempt = 0;
  for (;;) {
    try {
      return { ok: true, value: await send() };
    } catch (error) {
      if (isBlockingBatchError(error) || isTooLargeBatchError(error)) {
        return { ok: false, error, retryable: false };
      }
      if (isRetryableBatchError(error) && attempt < MAX_BATCH_RETRIES) {
        await sleep(backoffDelay(attempt));
        attempt += 1;
        continue;
      }
      return { ok: false, error, retryable: true };
    }
  }
}

/** 管理按文章隔离、可持久化并可逐批续传的上传计划（批量 + 轻量 v2 检查点）。 */
export function useChapterUpload({
  novelId,
  getDocument,
  getCoverage,
  ensureDocument,
  onNotice,
}: ChapterUploadOptions) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [diff, setDiff] = useState<ChapterUploadDiff | null>(null);
  const [hasCheckpoint, setHasCheckpoint] = useState(false);
  const checkpointRef = useRef<UploadCheckpointV2 | null>(null);
  const novelIdRef = useRef(novelId);
  novelIdRef.current = novelId;
  const operationRef = useRef(0);
  const runnerRef = useRef(false);
  const pauseRef = useRef(false);
  const progressRef = useRef<{ current: number | null; total: number | null }>({
    current: null,
    total: null,
  });
  const getDocumentRef = useRef(getDocument);
  const getCoverageRef = useRef(getCoverage);
  const ensureDocumentRef = useRef(ensureDocument);
  const onNoticeRef = useRef(onNotice);
  getDocumentRef.current = getDocument;
  getCoverageRef.current = getCoverage;
  ensureDocumentRef.current = ensureDocument;
  onNoticeRef.current = onNotice;

  const publishCheckpoint = useCallback((checkpoint: UploadCheckpointV2) => {
    if (checkpoint.novelId !== novelIdRef.current) return;
    checkpointRef.current = checkpoint;
    setDiff(toDiff(checkpoint, progressRef.current));
  }, []);

  const persistCheckpoint = useCallback(
    async (checkpoint: UploadCheckpointV2) => {
      checkpointRef.current = checkpoint;
      setDiff(toDiff(checkpoint, progressRef.current));
      await saveLongTextValue(checkpointKey(checkpoint.novelId), checkpoint);
    },
    [],
  );

  /** 完成某批后的共用收尾：写轻量检查点并检查暂停。 */
  const afterBatch = useCallback(
    async (checkpoint: UploadCheckpointV2, operation: number) => {
      progressRef.current = {
        ...progressRef.current,
        current: (progressRef.current.current ?? 0) + 1,
      };
      await persistCheckpoint({ ...checkpoint });
      if (operation !== operationRef.current) return true;
      if (pauseRef.current) {
        setHasCheckpoint(true);
        onNoticeRef.current("上传已暂停，可稍后继续");
        return true;
      }
      return false;
    },
    [persistCheckpoint],
  );

  useEffect(() => {
    const operation = ++operationRef.current;
    runnerRef.current = false;
    setOpen(false);
    setPreparing(false);
    setUploading(false);
    setDiff(null);
    setHasCheckpoint(false);
    checkpointRef.current = null;
    progressRef.current = { current: null, total: null };

    void loadLongTextValue<Record<string, unknown>>(checkpointKey(novelId))
      .then(async (stored) => {
        if (
          operation !== operationRef.current ||
          !stored ||
          stored.novelId !== novelId
        )
          return;
        const restored =
          stored.version === 2
            ? restoreCheckpoint(stored as unknown as UploadCheckpointV2)
            : await migrateV1Checkpoint(stored, novelId);
        if (!restored) {
          return;
        }
        if (stored.version !== 2) {
          await saveLongTextValue(checkpointKey(novelId), restored);
        }
        const unfinished = restored.chapters.some(
          (chapter) =>
            chapter.status === "待上传" ||
            (chapter.status === "失败" && chapter.retryable !== false),
        );
        if (!unfinished) {
          await deleteLongTextValue(checkpointKey(novelId));
          return;
        }
        if (operation !== operationRef.current) return;
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
    if (uploading) {
      pauseRef.current = true;
      setOpen(false);
      onNoticeRef.current("将在当前批次完成后暂停");
      return;
    }
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
      if (ensureDocumentRef.current) {
        const ready = await ensureDocumentRef.current();
        if (operation !== operationRef.current) return;
        if (!ready) {
          onNoticeRef.current("无法创建服务器文章，请检查网络后重试");
          return;
        }
      }
      const directory = await listForumChapters(capturedNovelId, {
        strict: true,
      });
      if (operation !== operationRef.current) return;
      const { checkpoint } = await buildCheckpoint(
        capturedNovelId,
        document,
        directory,
        collectRawGaps(getCoverageRef.current()).length,
      );
      if (operation !== operationRef.current) return;
      publishCheckpoint(checkpoint);
      setHasCheckpoint(
        checkpoint.chapters.some((chapter) => chapter.status === "待上传"),
      );
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

  const uploadBatch = useCallback(
    async (
      checkpoint: UploadCheckpointV2,
      operation: number,
      chapters: UploadCheckpointChapter[],
      contentByChapter: Map<
        string,
        { content: RichTextNode; hash: string; baseRevision: number }
      >,
    ): Promise<boolean> => {
      const items = chapters.map(
        (chapter): UploadBatchChapterItem => ({
          id: chapter.id,
          title: chapter.title,
          order: chapter.order,
          content: contentByChapter.get(chapter.id)!.content,
          hash: contentByChapter.get(chapter.id)!.hash,
          // 以章节状态为准：换序暂存响应可能已把版本推进到 baseRevision + 1。
          baseRevision: chapter.baseRevision,
        }),
      );
      const batches = splitUploadBatches(items);
      // 只建一次 id -> 状态 映射，避免每章在几千条记录里线性查找（O(n²)）。
      const stateById = new Map(
        checkpoint.chapters.map((chapter) => [chapter.id, chapter]),
      );
      progressRef.current = {
        current: progressRef.current.current ?? 0,
        total: (progressRef.current.total ?? 0) + batches.length,
      };
      for (const batch of batches) {
        for (const chapter of batch) {
          const state = stateById.get(chapter.id)!;
          state.status = "上传中";
          state.attempts += 1;
          delete state.error;
          delete state.retryable;
        }
        // 本批完成时统一发布一次状态（失败分支在收尾时发布）。
        // 413 时二分批次直到单章；其余错误交给退避重试。
        const queue: UploadBatchChapterItem[][] = [batch];
        let fatal:
          | {
              error: unknown;
              retryable: boolean;
              batch: UploadBatchChapterItem[];
            }
          | null = null;
        while (queue.length > 0) {
          const currentBatch = queue.shift()!;
          const outcome = await sendWithRetry(() =>
            uploadLongTextChaptersBatch(checkpoint.novelId, currentBatch),
          );
          if (outcome.ok) {
            const completed = new Map(
              outcome.value.chapters.map((result) => [result.id, result]),
            );
            for (const chapter of currentBatch) {
              const state = stateById.get(chapter.id)!;
              const result = completed.get(chapter.id);
              state.status = "已上传";
              state.baseRevision = result?.revision ?? state.baseRevision;
              delete state.error;
              delete state.retryable;
            }
            if (await afterBatch({ ...checkpoint }, operation)) return true;
            // 让浏览器处理本批的渲染与输入，避免连续批次饿死主线程。
            await yieldToUI();
            continue;
          }
          if (
            isTooLargeBatchError(outcome.error) &&
            bisectBatch(currentBatch) !== null
          ) {
            const halves = bisectBatch(currentBatch)!;
            // 保持原始顺序：先处理前半，再处理后半。
            queue.unshift(halves[0], halves[1]);
            continue;
          }
          fatal = {
            error: outcome.error,
            retryable: outcome.retryable,
            batch: currentBatch,
          };
          break;
        }
        if (fatal) {
          for (const chapter of fatal.batch) {
            const state = stateById.get(chapter.id)!;
            state.status = "失败";
            state.error =
              fatal.error instanceof Error ? fatal.error.message : "上传失败";
            state.retryable = fatal.retryable;
          }
          await persistCheckpoint({ ...checkpoint });
          setHasCheckpoint(true);
          const fatalBlocking =
            isBlockingUploadError(fatal.error) ||
            (fatal.error instanceof ApiError &&
              (fatal.error.status === 422 || fatal.error.status === 413));
          onNoticeRef.current(
            fatalBlocking
              ? `“${fatal.batch[0]?.title ?? ""}”存在版本、结构或大小冲突，请重新检查差异`
              : fatal.retryable
                ? "网络中断或服务端繁忙，已暂停；可点击继续上传重试"
                : `“${fatal.batch[0]?.title ?? ""}”上传失败，请重新检查差异`,
          );
          return true;
        }
      }
      return false;
    },
    [afterBatch, persistCheckpoint],
  );

  const uploadStaging = useCallback(
    async (
      checkpoint: UploadCheckpointV2,
      operation: number,
      stagedItems: StageChapterReorderItem[],
    ): Promise<boolean> => {
      const stateById = new Map(
        checkpoint.chapters.map((chapter) => [chapter.id, chapter]),
      );
      for (const batch of splitByCount(stagedItems, MAX_REORDER_PER_BATCH)) {
        const outcome = await sendWithRetry(() =>
          stageLongTextChapterReorder(checkpoint.novelId, batch),
        );
        if (!outcome.ok) {
          for (const item of batch) {
            const state = stateById.get(item.id)!;
            state.status = "失败";
            state.error =
              outcome.error instanceof Error
                ? outcome.error.message
                : "换序暂存失败";
            state.retryable = outcome.retryable;
          }
          await persistCheckpoint({ ...checkpoint });
          setHasCheckpoint(true);
          onNoticeRef.current(
            isBlockingUploadError(outcome.error)
              ? "换序时发生版本或顺序冲突，请重新检查差异"
              : "换序暂存中断，可点击继续上传重试",
          );
          return true;
        }
        for (const item of batch) {
          const state = stateById.get(item.id)!;
          const result = outcome.value.chapters.find(
            (entry) => entry.id === item.id,
          );
          state.baseRevision = result?.revision ?? state.baseRevision;
        }
        if (await afterBatch({ ...checkpoint }, operation)) return true;
        await yieldToUI();
      }
      checkpoint.reorderPhase = "content";
      await persistCheckpoint({ ...checkpoint });
      return false;
    },
    [afterBatch, persistCheckpoint],
  );

  const confirm = useCallback(async () => {
    const checkpoint = checkpointRef.current;
    if (!checkpoint || runnerRef.current) return;
    const operation = operationRef.current;
    pauseRef.current = false;
    runnerRef.current = true;
    setUploading(true);
    progressRef.current = { current: null, total: null };
    const capturedNovelId = checkpoint.novelId;
    try {
      // 简单模型：确认时直接按当前正文 + 服务器目录重建计划（按 id + hash
      // 判断“服务器有没有”），服务器已有的跳过、没有的上传。不再校验任何
      // 快照——正文本身就是唯一事实来源，编辑器回写也不会制造「已经对比了
      // 却还是过期」的阻塞。
      const draft = getDocumentRef.current();
      if ((draft.content ?? []).length === 0) {
        onNoticeRef.current("当前没有可上传的章节");
        return;
      }
      if (operation !== operationRef.current) return;
      const directory = await listForumChapters(capturedNovelId, {
        strict: true,
      });
      if (operation !== operationRef.current) return;
      const fresh = await buildCheckpoint(
        capturedNovelId,
        draft,
        directory,
        checkpoint.gaps,
      );
      if (operation !== operationRef.current) return;
      const contentByChapter = fresh.contentByChapter;
      // 合并旧计划的进度：已完成章节保持完成状态；失败/重试记录与尝试次数
      // 沿用，便于续传与展示；其余按最新对比结果重新判定。
      const previousById = new Map(
        checkpoint.chapters.map((chapter) => [chapter.id, chapter]),
      );
      for (const state of fresh.checkpoint.chapters) {
        const previous = previousById.get(state.id);
        if (!previous) continue;
        state.attempts = previous.attempts;
        if (previous.status === "已上传" && state.status !== "失败") {
          state.status = "已上传";
          state.baseRevision = previous.baseRevision;
        } else if (
          previous.status === "失败" &&
          state.status === "待上传"
        ) {
          // 不可重试冲突保持失败态（不重复进入上传队列）；
          // 可重试失败保留原错误与标记，便于界面定位与后续续传。
          if (previous.retryable === false) state.status = "失败";
          if (previous.error) state.error = previous.error;
          if (previous.retryable !== undefined)
            state.retryable = previous.retryable;
        }
      }
      checkpoint.chapters = fresh.checkpoint.chapters;
      checkpoint.gaps = fresh.checkpoint.gaps;
      checkpoint.reorderPhase = fresh.checkpoint.reorderPhase;
      checkpoint.temporaryOrders = fresh.checkpoint.temporaryOrders;
      await persistCheckpoint({ ...checkpoint });

      const freshDirectory = directory;
      const revisionById = new Map(
        freshDirectory.map((chapter) => [chapter.id, chapter.revision]),
      );
      const active = checkpoint.chapters.filter(
        (chapter) =>
          chapter.status === "待上传" ||
          (chapter.status === "失败" && chapter.retryable !== false),
      );
      const blocked = checkpoint.chapters.some(
        (chapter) => chapter.status === "失败" && chapter.retryable === false,
      );
      if (active.length === 0) {
        if (blocked) {
          setHasCheckpoint(true);
          onNoticeRef.current("上传计划存在版本或结构冲突，请重新检查差异");
          return;
        }
        setOpen(false);
        setHasCheckpoint(false);
        checkpointRef.current = null;
        await deleteLongTextValue(checkpointKey(checkpoint.novelId));
        onNoticeRef.current("服务器章节已是最新版本，无需重复上传");
        return;
      }
      const freshOrderById = new Map(
        freshDirectory.map((chapter) => [chapter.id, chapter]),
      );
      const maxServerOrder = Math.max(
        -1,
        ...freshDirectory.map((chapter) => chapter.order),
      );
      // 用 Map 查找代替 O(n²) 的数组 find，几千章时避免每章线性扫描目录。
      const moving = active.filter((chapter) => {
        const remote = freshOrderById.get(chapter.id);
        return remote && remote.order !== chapter.order;
      });
      if (moving.length > 0 && checkpoint.reorderPhase === "staging") {
        for (const [index, chapter] of moving.entries()) {
          if (!(chapter.id in checkpoint.temporaryOrders)) {
            checkpoint.temporaryOrders[chapter.id] = maxServerOrder + index + 1;
          }
        }
        const stagedItems = moving.map(
          (chapter): StageChapterReorderItem => ({
            id: chapter.id,
            temporaryOrder: checkpoint.temporaryOrders[chapter.id]!,
            baseRevision:
              revisionById.get(chapter.id) ?? chapter.baseRevision,
          }),
        );
        progressRef.current = {
          current: progressRef.current.current ?? 0,
          total: Math.ceil(stagedItems.length / MAX_REORDER_PER_BATCH),
        };
        if (await uploadStaging(checkpoint, operation, stagedItems)) return;
      }
      // 非移动章节以最新目录版本为准；移动章节保留暂存后的版本（暂存已递增）。
      const movingIds = new Set(moving.map((chapter) => chapter.id));
      for (const chapter of active) {
        if (movingIds.has(chapter.id)) continue;
        const refreshed = revisionById.get(chapter.id);
        if (refreshed !== undefined) chapter.baseRevision = refreshed;
      }
      const pending = checkpoint.chapters.filter(
        (chapter) =>
          chapter.status === "待上传" ||
          (chapter.status === "失败" && chapter.retryable !== false),
      );
      if (pending.length === 0) {
        setHasCheckpoint(false);
        checkpointRef.current = null;
        await deleteLongTextValue(checkpointKey(checkpoint.novelId));
        onNoticeRef.current("服务器章节已是最新版本，无需重复上传");
        return;
      }
      if (await uploadBatch(checkpoint, operation, pending, contentByChapter))
        return;

      const stillBlocked = checkpoint.chapters.some(
        (chapter) => chapter.status === "失败" && chapter.retryable === false,
      );
      if (stillBlocked) {
        setHasCheckpoint(true);
        await persistCheckpoint({ ...checkpoint });
        onNoticeRef.current(
          "其余章节存在版本、结构或大小冲突，需要重新检查差异",
        );
        return;
      }
      setHasCheckpoint(false);
      checkpointRef.current = null;
      await deleteLongTextValue(checkpointKey(checkpoint.novelId));
      onNoticeRef.current(
        `已分章上传 ${checkpoint.chapters.filter((chapter) => chapter.status === "已上传").length} 章`,
      );
      void queryClient.invalidateQueries({
        queryKey: ["forum", "chapters", capturedNovelId],
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
  }, [
    persistCheckpoint,
    publishCheckpoint,
    queryClient,
    uploadBatch,
    uploadStaging,
  ]);

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
