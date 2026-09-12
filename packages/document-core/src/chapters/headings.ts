import type { JSONContent } from "@tiptap/core";

/** 章节标题使用的标题层级：只有 H1 是章节，H2/H3/H4 都是章内小标题。 */
export const CHAPTER_HEADING_LEVEL = 1;

/** 章内小标题的基准层级。 */
const SUBHEADING_LEVEL = 2;

/** 章内小标题保留的最大层级（h2 → h3 → h4）。 */
const MAX_SUBHEADING_LEVEL = 4;

/** 该节点是否是标题节点。 */
function isHeading(node: JSONContent): boolean {
  return node.type === "heading";
}

/** 读取标题层级；非法或缺失时按章节层级处理，避免把章节标题误判成小标题。 */
function headingLevel(node: JSONContent): number {
  const level = node.attrs?.level;
  return typeof level === "number" && Number.isFinite(level) ? level : CHAPTER_HEADING_LEVEL;
}

/** 任意层级上的 chapterStart 标记（历史章节标题、显式标记都算）。 */
export function hasChapterMarker(node: JSONContent): boolean {
  return isHeading(node) && node.attrs?.chapterStart === true;
}

/** 显式章节标记，且层级已经是 H1。 */
export function isChapterHeading(node: JSONContent): boolean {
  return hasChapterMarker(node) && headingLevel(node) === CHAPTER_HEADING_LEVEL;
}

/** 升为章节标题：H1 + chapterStart，其余属性保持不变。 */
function promoteToChapter(node: JSONContent): JSONContent {
  if (node.attrs?.level === CHAPTER_HEADING_LEVEL && node.attrs?.chapterStart === true) return node;
  return {
    ...node,
    attrs: { ...node.attrs, level: CHAPTER_HEADING_LEVEL, chapterStart: true },
  };
}

/** 小标题：清掉章节标记并写到目标层级。 */
function asSubheading(node: JSONContent, level: number): JSONContent {
  if (node.attrs?.level === level && node.attrs?.chapterStart === false) return node;
  // 一律显式带 chapterStart: false，避免归一化结果在「有/无该属性」之间摇摆。
  return { ...node, attrs: { ...node.attrs, level, chapterStart: false } };
}

/**
 * 把章节标题层级归一化成「H1 = 章节」。
 *
 * 历史文档用 H2 标注章节（`level: 2` + `chapterStart: true`），层级规则调整后这些
 * 标题会变成「章内小标题」，目录会整片消失。两种情况分开处理：
 *
 * - 章节标题已经是 H1 → 文档已符合新模型，**只补齐属性、不动层级**，
 *   章内 H2/H3/H4 小标题原样保留；
 * - 章节标题还在更深层级（历史文档）→ 升到 H1，并把其它标题按「相对章节标题的深度」
 *   落到 H2/H3/H4：H1 书名 → H2，原 H2 小标题 → H3，依次类推；
 * - 文档里**没有任何章节标记**时，首个标题升级成唯一的章节标题（替代旧版
 *   「按 H2 兜底分章」）：整篇仍然是一章，H2/H3 小标题不会再各自变成章节。
 *
 * 变换是幂等的：处理过的文档再跑一次，返回的就是入参本身。
 */
export function normalizeChapterHeadings(document: JSONContent): JSONContent {
  return normalizeWithChapterLevel(document, chapterLevelOf(document));
}

/** 文档的章节标题层级；没有章节标题时返回 null。 */
export function chapterLevelOf(document: JSONContent): number | null {
  // 只看带 chapterStart 的标题：H1 上的是新写法，H2/H3 上的是历史写法。
  const markedLevels = (document.content ?? []).filter(hasChapterMarker).map(headingLevel);
  return markedLevels.length > 0 ? Math.min(...markedLevels) : null;
}

/**
 * 按给定的历史章节层级做归一化。
 *
 * 追加章节这类「先在旧文档上写内容、随后才归一化」的流程必须先把旧层级量出来再传进来：
 * 一旦文档里出现 H1 章节标题，就再也算不出原有小标题的相对深度了。
 */
export function normalizeWithChapterLevel(
  document: JSONContent,
  sourceChapterLevel: number | null,
): JSONContent {
  const content = document.content ?? [];
  const markedNodes = content.filter(hasChapterMarker);
  /**
   * 归一化后的文档：所有章节标题都在 H1，小标题层级不能再整体下移。
   *
   * 用「章节标题都在 H1」而不是「所有标记节点都在 H1」判断——追加章节时新标题
   * 已经是 H1，此时再去按深度搬动小标题就会反复下移。
   */
  const canonical =
    (sourceChapterLevel ?? CHAPTER_HEADING_LEVEL) === CHAPTER_HEADING_LEVEL ||
    (markedNodes.length > 0 &&
      Math.min(...markedNodes.map(headingLevel)) === CHAPTER_HEADING_LEVEL);
  let changed = false;

  const normalized = content.map((node) => {
    if (!isHeading(node)) return node;
    if (hasChapterMarker(node)) {
      const promoted = promoteToChapter(node);
      if (promoted !== node) changed = true;
      return promoted;
    }
    const level = canonical
      ? headingLevel(node)
      : SUBHEADING_LEVEL +
        Math.max(0, headingLevel(node) - (sourceChapterLevel ?? CHAPTER_HEADING_LEVEL));
    const subheading = asSubheading(node, Math.min(level, MAX_SUBHEADING_LEVEL));
    if (subheading !== node) changed = true;
    return subheading;
  });

  return changed ? { ...document, type: "doc", content: normalized } : document;
}
