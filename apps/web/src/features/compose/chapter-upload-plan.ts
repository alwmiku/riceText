import { convertLongTextBlocksToChapters } from "@ricetext/document-core";
import type { RichTextNode } from "../../lib/types";
import type {
  ChapterUploadPlan,
  PlannedUploadChapter,
  ChapterUploadAction,
  ChapterUploadStatus,
  ChapterUploadDiff,
} from "./chapter-upload-domain";
import {
  MAX_CHAPTER_CONTENT_BYTES,
  utf8ByteLength,
} from "./chapter-upload-batches";

const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * 章节 id 只认本地草稿创建时生成的不可变 SHA-256 id：绝不按服务器「同位置」
 * 回退对齐——服务器上同顺序的行可能是「正文」占位行或旧存储行，位置对齐
 * 会把几千个本地章节错认成同一批已存在章节（改数/冲突假象）。新文件上传
 * 模型下：id 相同就复用，id 不同就是新章。
 */
function resolveChapterId(node: RichTextNode, order: number): string {
  return String(node.attrs?.chapterId ?? `chapter-${order}`);
}

/** 服务器章节目录行（buildCheckpoint 使用的最小投影）。 */
export interface DirectoryChapter {
  id: string;
  title?: string;
  order: number;
  revision: number;
}

/** 对捕获的草稿执行一次转换，将分卷元数据纳入哈希计算并检查章节大小。
 * 服务器比对结果单独应用；此计算不执行网络或存储读写。
 */
export async function prepareChapterUploadPlan(
  capturedNovelId: string,
  document: RichTextNode,
  directory: readonly DirectoryChapter[],
  gaps: number,
  hashContent: (text: string) => Promise<string>,
): Promise<{
  checkpoint: ChapterUploadPlan;
  contentByChapter: Map<
    string,
    { content: RichTextNode; hash: string; baseRevision: number }
  >;
}> {
  const directoryById = new Map(
    directory.map((chapter) => [chapter.id, chapter]),
  );
  const nodes = document.content ?? [];
  const ids = nodes.map((node, order) => resolveChapterId(node, order));
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length) {
    throw new Error("本地章节标识为空或重复，请重新整理章节");
  }
  const chapters: PlannedUploadChapter[] = [];
  const contentByChapter = new Map<
    string,
    { content: RichTextNode; hash: string; baseRevision: number }
  >();
  // 分块转换 + 周期性让出主线程：几千章准备阶段仍然保持页面响应。
  for (let offset = 0; offset < nodes.length; offset += 64) {
    const converted = await Promise.all(
      nodes
        .slice(offset, offset + 64)
        .map(async (node, index): Promise<PlannedUploadChapter> => {
          const order = offset + index;
          const id = resolveChapterId(node, order);
          const title = String(node.attrs?.title ?? "未命名章节");
          const volumeTitle = String(node.attrs?.volumeTitle ?? "");
          const normalizedNode: RichTextNode = {
            ...node,
            attrs: { ...node.attrs, chapterId: id, order },
          };
          const content = convertLongTextBlocksToChapters({
            type: "doc",
            content: [normalizedNode],
          }) as RichTextNode;
          const hash = await hashContent(
            JSON.stringify({ title, volumeTitle, order, content }),
          );
          const oversized =
            utf8ByteLength(JSON.stringify(content)) > MAX_CHAPTER_CONTENT_BYTES;
          const baseRevision = directoryById.get(id)?.revision ?? 0;
          contentByChapter.set(id, { content, hash, baseRevision });
          return {
            id,
            title,
            volumeTitle,
            order,
            hash,
            baseRevision,
            action: "unchanged" as ChapterUploadAction,
            status: "unchanged" as ChapterUploadStatus,
            attempts: 0,
            ...(oversized
              ? {
                  status: "failed" as ChapterUploadStatus,
                  retryable: false,
                  error: `单章标准化正文超过 1.8 MiB，请先拆分“${title}”`,
                }
              : {}),
          };
        }),
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
  return {
    checkpoint: { novelId: capturedNovelId, gaps, chapters },
    contentByChapter,
  };
}

/** 应用服务器哈希比对结果，同时保持本地章节标识不变。 */
export function applyChapterUploadSync(
  plan: ChapterUploadPlan,
  directory: readonly DirectoryChapter[],
  sync: { toUpdate: readonly string[]; existing: readonly string[] },
): ChapterUploadPlan {
  const { chapters, novelId, gaps } = plan;
  const localIds = new Set(chapters.map((chapter) => chapter.id));
  const toUpdate = new Set(sync.toUpdate);
  const existing = new Set(sync.existing);
  const checkpoint: ChapterUploadPlan = {
    novelId,
    gaps,
    chapters: [
      ...chapters.map((chapter) => ({
        ...chapter,
        action:
          chapter.status === "failed"
            ? ("add" as const)
            : !toUpdate.has(chapter.id)
              ? ("unchanged" as const)
              : existing.has(chapter.id)
                ? ("modify" as const)
                : ("add" as const),
        status:
          chapter.status === "failed"
            ? ("failed" as const)
            : toUpdate.has(chapter.id)
              ? ("pending" as const)
              : ("unchanged" as const),
      })),
      ...directory
        .filter((remote) => !localIds.has(remote.id))
        .map((remote) => ({
          id: remote.id,
          title: remote.title ?? remote.id,
          volumeTitle: "",
          order: remote.order,
          hash: "",
          baseRevision: remote.revision,
          action: "remote_only" as const,
          status: "awaiting_replacement" as const,
          attempts: 0,
        })),
    ],
  };
  return checkpoint;
}

export function toUploadDiff(
  checkpoint: ChapterUploadPlan,
  progress: { current: number | null; total: number | null },
): ChapterUploadDiff {
  const rows = checkpoint.chapters.map(
    ({
      id,
      title,
      volumeTitle,
      action,
      status,
      attempts,
      error,
      retryable,
    }) => ({
      id,
      title,
      ...(volumeTitle !== undefined ? { volumeTitle } : {}),
      action,
      status,
      attempts,
      ...(error ? { error } : {}),
      ...(retryable === false ? { retryable } : {}),
    }),
  );
  return {
    published: false,
    total: rows.filter((row) => row.action !== "remote_only").length,
    toUpdate: rows.filter((row) => row.action !== "remote_only").length,
    added: rows.filter((row) => row.action === "add").length,
    modified: rows.filter((row) => row.action === "modify").length,
    remoteOnly: rows.filter((row) => row.action === "remote_only").length,
    uploaded: rows.filter((row) => row.status === "uploaded").length,
    failed: rows.filter((row) => row.status === "failed").length,
    pending: rows.filter(
      (row) => row.status === "pending" || row.status === "uploading",
    ).length,
    gaps: checkpoint.gaps,
    batchCurrent: progress.current,
    batchTotal: progress.total,
    rows,
  };
}
