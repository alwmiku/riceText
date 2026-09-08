import type {
  ChapterUploadAction,
  ChapterUploadPlan,
  ChapterUploadStatus,
} from "./chapter-upload-domain";

/** 仅持久化元数据的契约，独立于对话框和编辑器类型。 */
export interface UploadCheckpointV6 {
  version: 6;
  novelId: string;
  gaps: number;
  chapters: Array<{
    id: string;
    title: string;
    volumeTitle?: string;
    order: number;
    hash: string;
    baseRevision: number;
    action: ChapterUploadAction;
    status: ChapterUploadStatus;
    attempts: number;
    error?: string;
    retryable?: boolean;
  }>;
}

export const checkpointKey = (novelId: string) =>
  "ricetext:long-text-upload:" + novelId;

export type CheckpointDecodeResult =
  | { kind: "missing" }
  | { kind: "invalid"; reason: "version" | "shape" | "identity" }
  | { kind: "valid"; plan: ChapterUploadPlan; migrated: boolean };

const legacyActions: Record<string, ChapterUploadAction> = {
  新增: "add",
  修改: "modify",
  未变化: "unchanged",
  服务器额外: "remote_only",
};
const legacyStatuses: Record<string, ChapterUploadStatus> = {
  待上传: "pending",
  上传中: "uploading",
  已上传: "uploaded",
  未变化: "unchanged",
  待整套替换: "awaiting_replacement",
  失败: "failed",
};
const actions = new Set<string>(Object.values(legacyActions));
const statuses = new Set<string>(Object.values(legacyStatuses));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const chapterKeys = [
  "id",
  "title",
  "volumeTitle",
  "order",
  "hash",
  "baseRevision",
  "action",
  "status",
  "attempts",
  "error",
  "retryable",
];

/** 解码不可信的存储数据；仅将 v5 中已知的中文值迁移为 v6 代码。 */
export function decodeUploadCheckpoint(
  value: unknown,
  novelId: string,
): CheckpointDecodeResult {
  if (value === undefined) return { kind: "missing" };
  if (!isRecord(value)) return { kind: "invalid", reason: "shape" };
  if (value.version !== 5 && value.version !== 6)
    return { kind: "invalid", reason: "version" };
  if (value.novelId !== novelId) return { kind: "invalid", reason: "identity" };
  if (
    !hasOnlyKeys(value, ["version", "novelId", "gaps", "chapters"]) ||
    !novelId.trim() ||
    !isCount(value.gaps) ||
    !Array.isArray(value.chapters) ||
    value.chapters.length === 0
  ) {
    return { kind: "invalid", reason: "shape" };
  }
  const chapters: ChapterUploadPlan["chapters"] = [];
  const ids = new Set<string>();
  let nextOrder = 0;
  let remoteStarted = false;
  for (const entry of value.chapters) {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, chapterKeys) ||
      typeof entry.id !== "string" ||
      !entry.id.trim() ||
      ids.has(entry.id) ||
      typeof entry.title !== "string" ||
      (entry.volumeTitle !== undefined &&
        typeof entry.volumeTitle !== "string") ||
      !isCount(entry.order) ||
      !isCount(entry.baseRevision) ||
      !isCount(entry.attempts) ||
      typeof entry.hash !== "string" ||
      typeof entry.action !== "string" ||
      typeof entry.status !== "string" ||
      (entry.error !== undefined && typeof entry.error !== "string") ||
      (entry.retryable !== undefined && typeof entry.retryable !== "boolean")
    ) {
      return { kind: "invalid", reason: "shape" };
    }
    const action =
      value.version === 5
        ? Object.hasOwn(legacyActions, entry.action)
          ? legacyActions[entry.action]
          : undefined
        : actions.has(entry.action)
          ? (entry.action as ChapterUploadAction)
          : undefined;
    const status =
      value.version === 5
        ? Object.hasOwn(legacyStatuses, entry.status)
          ? legacyStatuses[entry.status]
          : undefined
        : statuses.has(entry.status)
          ? (entry.status as ChapterUploadStatus)
          : undefined;
    if (!action || !status) return { kind: "invalid", reason: "shape" };
    const remote = action === "remote_only";
    if (remote) remoteStarted = true;
    // 远程目录顺序可与本地顺序重叠；本地顺序必须连续。
    if (
      remote
        ? status !== "awaiting_replacement" || entry.hash !== ""
        : remoteStarted ||
          entry.order !== nextOrder++ ||
          status === "awaiting_replacement" ||
          !/^[a-f0-9]{64}$/.test(entry.hash)
    ) {
      return { kind: "invalid", reason: "shape" };
    }
    if (status === "unchanged" && action !== "unchanged")
      return { kind: "invalid", reason: "shape" };
    ids.add(entry.id);
    chapters.push({
      id: entry.id,
      title: entry.title,
      order: entry.order,
      hash: entry.hash,
      baseRevision: entry.baseRevision,
      action,
      status,
      attempts: entry.attempts,
      ...(entry.volumeTitle !== undefined
        ? { volumeTitle: entry.volumeTitle }
        : {}),
      ...(entry.error !== undefined ? { error: entry.error } : {}),
      ...(entry.retryable !== undefined ? { retryable: entry.retryable } : {}),
    });
  }
  if (nextOrder === 0) return { kind: "invalid", reason: "shape" };
  return {
    kind: "valid",
    plan: { novelId, gaps: value.gaps, chapters },
    migrated: value.version === 5,
  };
}

/** 通过显式投影和复制，避免将临时字段及后续修改写入存储。 */
export function encodeUploadCheckpoint(
  plan: ChapterUploadPlan,
): UploadCheckpointV6 {
  return {
    version: 6,
    novelId: plan.novelId,
    gaps: plan.gaps,
    chapters: plan.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      order: chapter.order,
      hash: chapter.hash,
      baseRevision: chapter.baseRevision,
      action: chapter.action,
      status: chapter.status,
      attempts: chapter.attempts,
      ...(chapter.volumeTitle !== undefined
        ? { volumeTitle: chapter.volumeTitle }
        : {}),
      ...(chapter.error !== undefined ? { error: chapter.error } : {}),
      ...(chapter.retryable !== undefined
        ? { retryable: chapter.retryable }
        : {}),
    })),
  };
}

/** 与服务器核对后，可重新发送中断的请求及可重试的失败项。 */
export function restoreUploadPlan(plan: ChapterUploadPlan): ChapterUploadPlan {
  return {
    ...plan,
    chapters: plan.chapters.map((chapter) => {
      if (
        chapter.status !== "uploading" &&
        !(chapter.status === "failed" && chapter.retryable !== false)
      )
        return { ...chapter };
      const restored = { ...chapter, status: "pending" as const };
      delete restored.error;
      delete restored.retryable;
      return restored;
    }),
  };
}
