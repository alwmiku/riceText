import type { ForumChapterItem } from "../../lib/types";

/** 参与目录身份解析的最小章节形态。 */
export interface DirectoryIdentityChapter {
  id: string;
  /** 身份是否来自正文节点上持久化的 chapterId。 */
  explicitIdentity: boolean;
}

/**
 * 把正文中的章节解析到服务器目录实体。
 *
 * 这是 Web 侧**唯一**的位置兼容入口：
 * 1. 正文里的身份能在目录中找到时只认精确 ID；
 * 2. 否则只接受唯一 order 对齐（order 由服务端目录给出，不自行推导）。
 * 返回 undefined 表示无法确认，调用方必须阻止远端保存，不能猜第一条目录行。
 */
export function resolveChapterDirectoryIdentity(
  directory: readonly ForumChapterItem[],
  chapter: DirectoryIdentityChapter,
  order?: number,
): string | undefined {
  const exact = directory.find((row) => row.id === chapter.id);
  if (exact) return exact.id;
  // 正文里的身份可能不是目录 id（历史格式）：只有唯一 order 才能确认对应关系。
  // order 由服务端目录给出，调用方不得自行推导。
  if (order === undefined) return undefined;
  const byOrder = directory.filter((row) => row.order === order);
  return byOrder.length === 1 ? byOrder[0]!.id : undefined;
}
