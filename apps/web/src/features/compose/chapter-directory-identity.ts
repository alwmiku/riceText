import type { ForumChapterItem } from "../../lib/types";

/**
 * 把正文中的活动章节解析到服务器目录实体。稳定 ID 优先；旧正文才允许使用唯一 order 对齐。
 * 返回 undefined 表示目录存在歧义，调用方必须阻止远端保存，不能猜测第一条目录行。
 */
export function resolveChapterDirectoryIdentity(
  directory: readonly ForumChapterItem[],
  activeIndex: number,
  fallbackId: string,
): string | undefined {
  const exact = directory.find((row) => row.id === fallbackId);
  if (exact) return exact.id;
  const byOrder = directory.filter((row) => row.order === activeIndex);
  return byOrder.length === 1 ? byOrder[0]!.id : undefined;
}
