/** 可参与文章层级投影的最小章节形态。 */
export interface ChapterHierarchyItem {
  id: string;
  volumeTitle?: string | undefined;
}

/** 一个连续卷段；保留章节原索引，调用方无需从展示分组反推位置。 */
export interface ChapterVolumeGroup<T extends ChapterHierarchyItem> {
  /** 当前连续卷段的展示身份；未来可无缝替换为持久化 volumeId。 */
  key: string;
  title: string;
  items: Array<{ chapter: T; index: number }>;
}

/** 统一清理卷标题；空字符串表示文章直属章节。 */
export function chapterVolumeTitle(chapter: ChapterHierarchyItem | undefined): string {
  return chapter?.volumeTitle?.trim() ?? "";
}

/** 以连续卷段首章的稳定 ID 构造展示 key，避免同名非连续卷共享状态。 */
export function chapterVolumeKey(chapters: readonly ChapterHierarchyItem[], index: number): string {
  const title = chapterVolumeTitle(chapters[index]);
  if (!title) return "";
  let start = index;
  while (start > 0 && chapterVolumeTitle(chapters[start - 1]) === title) start -= 1;
  return "volume:" + (chapters[start]?.id ?? String(start));
}

/** 当前章节是否是一个具名卷的第一章。 */
export function startsChapterVolume(
  chapters: readonly ChapterHierarchyItem[],
  index: number,
): boolean {
  const title = chapterVolumeTitle(chapters[index]);
  return Boolean(title) && chapterVolumeTitle(chapters[index - 1]) !== title;
}

/**
 * 按文章顺序投影连续卷段。卷目前是章节元数据上的展示层级，不在这里虚构持久化 ID。
 */
export function groupChaptersByVolume<T extends ChapterHierarchyItem>(
  chapters: readonly T[],
): Array<ChapterVolumeGroup<T>> {
  const groups: Array<ChapterVolumeGroup<T>> = [];
  chapters.forEach((chapter, index) => {
    const title = chapterVolumeTitle(chapter);
    const previous = groups.at(-1);
    if (!previous || previous.title !== title) {
      groups.push({ key: chapterVolumeKey(chapters, index), title, items: [{ chapter, index }] });
      return;
    }
    previous.items.push({ chapter, index });
  });
  return groups;
}

/** 激活章节所在卷不能保持折叠；没有变化时复用原 Set，避免无效渲染。 */
export function expandActiveChapterVolume(
  collapsed: ReadonlySet<string>,
  chapters: readonly ChapterHierarchyItem[],
  activeIndex: number,
): Set<string> {
  const key = chapterVolumeKey(chapters, activeIndex);
  if (!key || !collapsed.has(key)) return collapsed as Set<string>;
  const next = new Set(collapsed);
  next.delete(key);
  return next;
}
