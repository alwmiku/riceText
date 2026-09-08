/** 仅包含上传哈希覆盖的字段，并遵循协议规定的稳定键顺序。 */
export interface ChapterUploadManifestItem {
  id: string;
  title: string;
  volumeTitle?: string;
  order: number;
  hash: string;
}

export function normalizeChapterUploadManifest(
  items: readonly ChapterUploadManifestItem[],
) {
  // 原样保留顺序和文本：排序或去除首尾空白会改变既有哈希。
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    volumeTitle: item.volumeTitle ?? "",
    order: item.order,
    hash: item.hash,
  }));
}

export function serializeChapterUploadManifest(
  items: readonly ChapterUploadManifestItem[],
): string {
  return JSON.stringify(normalizeChapterUploadManifest(items));
}

/** 即使内容哈希未变，暂存也必须与基线完全一致。 */
export function decideChapterUploadWrite(
  active: { revision: number; content_hash: string | null } | undefined,
  input: { baseRevision: number; hash: string },
):
  | { status: "conflict"; currentRevision: number }
  | { status: "saved" | "unchanged"; revision: number } {
  const currentRevision = active?.revision ?? 0;
  if (currentRevision !== input.baseRevision)
    return { status: "conflict", currentRevision };
  if (currentRevision > 0 && active?.content_hash === input.hash) {
    return { status: "unchanged", revision: currentRevision };
  }
  return { status: "saved", revision: input.baseRevision + 1 };
}
