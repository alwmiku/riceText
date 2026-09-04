import { convertLongTextBlocksToChapters } from "@ricetext/document-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  completeLongTextChapterUpload,
  createLongTextChapterUpload,
  deleteDocumentChapter,
  listForumChapters,
  stageLongTextChapterUploadBatch,
  syncLongTextChapters,
} from "../../lib/api";
import {
  deleteLongTextValue,
  loadLongTextValue,
  saveLongTextValue,
} from "../../lib/long-text-draft-storage";
import type { RichTextNode } from "../../lib/types";
import { sha256Hex } from "../../lib/utils";
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
  splitUploadBatches,
  utf8ByteLength,
  type UploadBatchChapterItem,
} from "./chapter-upload-batches";

/** v4 检查点使用服务端上传会话，只保存元数据和逐批状态。 */
interface UploadCheckpointChapter extends ChapterUploadRow {
  order: number;
  hash: string;
  baseRevision: number;
}

interface UploadCheckpointV3 {
  version: 4;
  novelId: string;
  gaps: number;
  chapters: UploadCheckpointChapter[];
}

interface ChapterUploadOptions {
  novelId: string;
  getDocument: () => RichTextNode;
  getCoverage: () => readonly CoverageChapter[];
  ensureDocument?: () => Promise<"created" | "existing" | false>;
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

/**
 * 章节 id 只认本地草稿创建时生成的不可变 SHA-256 id：绝不按服务器「同位置」
 * 回退对齐——服务器上同顺序的行可能是「正文」占位行或旧存储行，位置对齐
 * 会把几千个本地章节错认成同一批已存在章节（改数/冲突假象）。新文件上传
 * 模型下：id 相同就复用，id 不同就是新章。
 */
function resolveChapterId(
  node: RichTextNode,
  order: number,
  _novelId: string,
): string {
  return String(node.attrs?.chapterId ?? `chapter-${order}`);
}

/** 服务器章节目录行（buildCheckpoint 使用的最小投影）。 */
interface DirectoryChapter {
  id: string;
  title?: string;
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
  checkpoint: UploadCheckpointV3;
  contentByChapter: Map<
    string,
    { content: RichTextNode; hash: string; baseRevision: number }
  >;
}> {
  const directoryById = new Map(
    directory.map((chapter) => [chapter.id, chapter]),
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
        async (node, index): Promise<UploadCheckpointChapter> => {
          const order = offset + index;
          const id = resolveChapterId(node, order, capturedNovelId);
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
  const invalidOrder = chapters.findIndex(
    (chapter, expectedOrder) => chapter.order !== expectedOrder,
  );
  if (invalidOrder >= 0) {
    throw new Error(
      `本地章节顺序计算异常：第 ${invalidOrder + 1} 章得到 order ${chapters[invalidOrder]!.order}`,
    );
  }
  const sync = await syncLongTextChapters(
    capturedNovelId,
    chapters.map(({ id, title, order, hash }) => ({ id, title, order, hash })),
  );
  const toUpdate = new Set(sync.toUpdate);
  const existing = new Set(sync.existing);
  const checkpoint: UploadCheckpointV3 = {
    version: 4,
    novelId: capturedNovelId,
    gaps,
    chapters: [
      ...chapters.map((chapter) => ({
        ...chapter,
        action:
          chapter.status === "失败"
            ? ("新增" as const)
            : !toUpdate.has(chapter.id)
              ? ("未变化" as const)
              : existing.has(chapter.id)
                ? ("修改" as const)
                : ("新增" as const),
        status:
          chapter.status === "失败"
            ? ("失败" as const)
            : toUpdate.has(chapter.id)
              ? ("待上传" as const)
              : ("未变化" as const),
      })),
      ...directory
        .filter((remote) => !chapters.some((local) => local.id === remote.id))
        .map((remote) => ({
          id: remote.id,
          title: remote.title ?? remote.id,
          order: remote.order,
          hash: "",
          baseRevision: remote.revision,
          action: "服务器额外" as const,
          status: "待整套替换" as const,
          attempts: 0,
        })),
    ],
  };
  return { checkpoint, contentByChapter };
}

/** 恢复上传计划：上传中/可重试失败统一回到待上传。 */
function restoreCheckpoint(stored: UploadCheckpointV3): UploadCheckpointV3 {
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
  checkpoint: UploadCheckpointV3,
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
    total: rows.filter((row) => row.action !== "服务器额外").length,
    toUpdate: rows.filter((row) => row.action !== "服务器额外").length,
    added: rows.filter((row) => row.action === "新增").length,
    modified: rows.filter((row) => row.action === "修改").length,
    remoteOnly: rows.filter((row) => row.action === "服务器额外").length,
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
  const checkpointRef = useRef<UploadCheckpointV3 | null>(null);
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

  const publishCheckpoint = useCallback((checkpoint: UploadCheckpointV3) => {
    if (checkpoint.novelId !== novelIdRef.current) return;
    checkpointRef.current = checkpoint;
    setDiff(toDiff(checkpoint, progressRef.current));
  }, []);

  const persistCheckpoint = useCallback(
    async (checkpoint: UploadCheckpointV3) => {
      checkpointRef.current = checkpoint;
      setDiff(toDiff(checkpoint, progressRef.current));
      await saveLongTextValue(checkpointKey(checkpoint.novelId), checkpoint);
    },
    [],
  );

  /** 完成某批后的共用收尾：写轻量检查点并检查暂停。 */
  const afterBatch = useCallback(
    async (checkpoint: UploadCheckpointV3, operation: number) => {
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
        if (stored.version !== 4) {
          await deleteLongTextValue(checkpointKey(novelId));
          return;
        }
        const restored = restoreCheckpoint(
          stored as unknown as UploadCheckpointV3,
        );
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
      let documentState: "created" | "existing" = "existing";
      if (ensureDocumentRef.current) {
        const ready = await ensureDocumentRef.current();
        if (operation !== operationRef.current) return;
        if (!ready) {
          onNoticeRef.current("无法创建服务器文章，请检查网络后重试");
          return;
        }
        documentState = ready;
      }
      let directory = await listForumChapters(capturedNovelId, {
        strict: true,
      });
      if (operation !== operationRef.current) return;
      // 首次创建服务器文章时，普通正文模型会生成唯一的空“正文”目录占位。
      // 它不是用户章节，长文本上传前应清掉，避免被暂存到正文中间或末尾。
      const placeholder =
        documentState === "created" &&
        directory.length === 1 &&
        directory[0]?.id === "chapter-0" &&
        directory[0]?.title === "正文" &&
        directory[0]?.revision === 1
          ? directory[0]
          : undefined;
      if (placeholder) {
        await deleteDocumentChapter(capturedNovelId, placeholder.id);
        if (operation !== operationRef.current) return;
        directory = [];
      }
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
      checkpoint: UploadCheckpointV3,
      operation: number,
      uploadId: string,
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
            stageLongTextChapterUploadBatch(
              checkpoint.novelId,
              uploadId,
              currentBatch,
            ),
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
          // 带上 HTTP 状态码与服务端错误码/详情，便于直接定位是哪类错误。
          const serverDetail =
            (fatal.error instanceof ApiError
              ? `[${fatal.error.status} ${fatal.error.code}]${fatal.error.details ? " " + JSON.stringify(fatal.error.details) : ""}`
              : "") || undefined;
          for (const chapter of fatal.batch) {
            const state = stateById.get(chapter.id)!;
            state.status = "失败";
            state.error =
              (fatal.error instanceof Error ? fatal.error.message : "上传失败") +
              (serverDetail ? `（${serverDetail}）` : "");
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
              ? `“${fatal.batch[0]?.title ?? ""}”存在版本、结构或大小冲突${serverDetail ?? ""}，请重新检查差异`
              : fatal.retryable
                ? `“${fatal.batch[0]?.title ?? ""}”上传中断（${serverDetail ?? "网络错误"}），继续上传剩余批次，可稍后重试`
                : `“${fatal.batch[0]?.title ?? ""}”上传失败，请重新检查差异`,
          );
          // 单批失败不中断整个上传：标记失败后继续下一批；暂停请求仍生效。
          if (pauseRef.current) return true;
          await yieldToUI();
        }
      }
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
      checkpoint.chapters = fresh.checkpoint.chapters;
      checkpoint.gaps = fresh.checkpoint.gaps;
      const local = checkpoint.chapters.filter(
        (chapter) => chapter.action !== "服务器额外",
      );
      const blocked = checkpoint.chapters.some(
        (chapter) => chapter.status === "失败" && chapter.retryable === false,
      );
      if (blocked) {
        setHasCheckpoint(true);
        onNoticeRef.current("上传计划存在结构或大小冲突，请重新检查差异");
        return;
      }
      const manifestHash = await sha256Hex(
        JSON.stringify(
          local.map((chapter) => ({
            id: chapter.id,
            title: chapter.title,
            order: chapter.order,
            hash: chapter.hash,
          })),
        ),
      );
      const session = await createLongTextChapterUpload(
        checkpoint.novelId,
        manifestHash,
        local.length,
      );
      const staged = new Set(session.staged);
      for (const chapter of local) {
        chapter.status = staged.has(chapter.id) ? "已上传" : "待上传";
      }
      await persistCheckpoint({ ...checkpoint });
      const pending = local.filter((chapter) => !staged.has(chapter.id));
      if (
        pending.length > 0 &&
        (await uploadBatch(
          checkpoint,
          operation,
          session.uploadId,
          pending,
          contentByChapter,
        ))
      )
        return;

      // 单批失败不再中断整次上传；只要还有失败章节就保留检查点（含重试
      // 可用的网络失败与不可重试的冲突），其余章节照常显示为已完成。
      const failedCount = checkpoint.chapters.filter(
        (chapter) => chapter.status === "失败",
      ).length;
      const uploadedCount = checkpoint.chapters.filter(
        (chapter) => chapter.status === "已上传",
      ).length;
      if (failedCount > 0) {
        setHasCheckpoint(true);
        await persistCheckpoint({ ...checkpoint });
        const stillBlocked = checkpoint.chapters.some(
          (chapter) =>
            chapter.status === "失败" && chapter.retryable === false,
        );
        onNoticeRef.current(
          stillBlocked
            ? `已完成 ${uploadedCount} 章，${failedCount} 章存在版本、结构或大小冲突，可点“继续上传”重试`
            : `已完成 ${uploadedCount} 章，${failedCount} 章上传中断，可点“继续上传”重试`,
        );
        return;
      }
      await completeLongTextChapterUpload(
        checkpoint.novelId,
        session.uploadId,
      );
      setHasCheckpoint(false);
      checkpointRef.current = null;
      await deleteLongTextValue(checkpointKey(checkpoint.novelId));
      onNoticeRef.current(
        checkpoint.gaps > 0
            ? `已分章上传 ${uploadedCount} 章；仍有 ${checkpoint.gaps} 段原文未切分`
            : `已原子发布 ${uploadedCount} 章，服务器与本地长文本完全一致`,
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
