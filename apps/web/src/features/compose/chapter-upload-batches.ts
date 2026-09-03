import { ApiError } from "../../lib/api";
import type { StageChapterReorderItem, UploadBatchChapterItem } from "../../lib/api";

/** 每批最多 20 章（与 D1 Free 每次 Worker 调用 50 条查询上限对齐）。 */
export const MAX_CHAPTERS_PER_BATCH = 20;
/** 每批序列化请求体上限（约 4 MiB），低于路由的 5 MiB 硬上限。 */
export const MAX_BATCH_BYTES = 4 * 1024 * 1024;
/** 单章标准化正文上限（约 1.8 MiB），避免撞上 D1 单行 2 MB 上限。 */
export const MAX_CHAPTER_CONTENT_BYTES = 1.8 * 1024 * 1024;
/** 换序暂存每批最多 40 项（1 + 1 + 40 条语句仍在 50 条查询上限内）。 */
export const MAX_REORDER_PER_BATCH = 40;
/** 429/5xx/网络中断对同一批的最大重试次数（指数退避）。 */
export const MAX_BATCH_RETRIES = 3;

export const batchEncoder = new TextEncoder();

/** JSON 文本的 UTF-8 字节数（与服务端 Content-Length/序列化校验一致）。 */
export function utf8ByteLength(text: string): number {
  return batchEncoder.encode(text).byteLength;
}

/**
 * 按「最多 20 章且序列化请求体不超过 4 MiB」把待上传章节切成顺序批次。
 * 单章超过 4 MiB 时仍会独占一批，由路由 413/事前超限检查兜底。
 *
 * 每章只序列化一次得到字节大小，再用前缀和贪心切批；最后对每批做一次
 * 精确序列化校验，避免几千章时对整个候选批反复 JSON.stringify。
 */
export function splitUploadBatches(
  chapters: readonly UploadBatchChapterItem[],
  options: {
    maxCount?: number;
    maxBytes?: number;
  } = {},
): UploadBatchChapterItem[][] {
  const maxCount = options.maxCount ?? MAX_CHAPTERS_PER_BATCH;
  const maxBytes = options.maxBytes ?? MAX_BATCH_BYTES;
  // {"chapters":[...]} 信封固定约 15 字节；每项之间 1 字节逗号。
  const envelopeBytes = 15;
  const batches: UploadBatchChapterItem[][] = [];
  let current: UploadBatchChapterItem[] = [];
  let currentBytes = 0;
  const flush = () => {
    if (current.length > 0) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
  };
  for (const chapter of chapters) {
    // size 按“项 + 逗号”估算（含末项逗号，恒为实际值 +1 的上界）。
    const size = utf8ByteLength(JSON.stringify(chapter)) + 1;
    if (
      current.length > 0 &&
      (current.length + 1 > maxCount ||
        currentBytes + size + envelopeBytes > maxBytes)
    ) {
      flush();
    }
    current.push(chapter);
    currentBytes += size;
  }
  flush();
  return batches;
}

/** 按条数切批（换序暂存等轻量请求）。 */
export function splitByCount<T>(
  items: readonly T[],
  maxCount = MAX_REORDER_PER_BATCH,
): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += maxCount) {
    batches.push(items.slice(index, index + maxCount));
  }
  return batches;
}

/** 413 命中时把一批二分，直到单章仍超限为止。 */
export function bisectBatch<T>(batch: readonly T[]): [T[], T[]] | null {
  if (batch.length <= 1) return null;
  const mid = Math.ceil(batch.length / 2);
  return [batch.slice(0, mid), batch.slice(mid)];
}

/** 409/422 等结构性冲突：不自动重试。 */
export function isBlockingBatchError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status === 409 || error.status === 422 || error.status === 413;
}

/** 413（请求体太大）：需要二分批次而非直接重试同一批。 */
export function isTooLargeBatchError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 413;
}

/** 429、D1 overloaded（5xx）和网络中断：可指数退避重试。 */
export function isRetryableBatchError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 429 || error.status === 503 || error.status >= 500;
  }
  return true;
}

/** 指数退避：250ms、500ms、1s（重试序号从 0 开始）。 */
export function backoffDelay(retryIndex: number): number {
  return 250 * 2 ** retryIndex;
}

export type { StageChapterReorderItem, UploadBatchChapterItem };
