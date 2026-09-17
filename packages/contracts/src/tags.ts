/**
 * 文章标签的共享规则。
 *
 * 标签属于**整篇文章**（与章节无关），分两类：
 * - 服务器标签：站点字典（`tags` 表）里的条目，只有版主能维护，文章只能引用未隐藏的条目；
 * - 作者标签：作者手动输入的 `#标签`，只属于当前文章，**绝不会**因此往站点字典里写新行。
 *
 * 规范化与解析必须由编辑器、Worker 和测试共用同一份实现：`apps/web` 不依赖
 * `server-core`，而两边都依赖 `contracts`，所以规则放在这里而不是任何一侧。
 */

/** 一篇文章最多携带的标签数。 */
export const TAG_LIMIT = 5;

/** 单个标签展示文本的最大长度（按 Unicode 码点计，不是 UTF-16 长度）。 */
export const TAG_LABEL_MAX = 24;

/** 标签 slug 的最大长度；slug 是去重与匹配用的稳定键。 */
export const TAG_SLUG_MAX = 48;

/** 服务器标签说明的最大长度。 */
export const TAG_DESCRIPTION_MAX = 200;

/** 原始输入的硬上限：先容纳全角 `＃`、前后空白等修饰，再规范化到 TAG_LABEL_MAX。 */
export const TAG_INPUT_MAX = 64;

/** 标签来源：server 只能引用字典，author 是作者自建。 */
export type TagSource = "server" | "author";

/** 解析文章标签时的失败码；与 Worker 返回的错误码一一对应。 */
export type TagResolutionErrorCode = "TAG_LABEL_INVALID" | "TAG_LIMIT_EXCEEDED";

/** 解析后的文章标签：`tagId` 仅在服务器标签上有值。 */
export interface ResolvedDocumentTag {
  /** 去重与匹配键，同一篇文章内唯一。 */
  slug: string;
  /** 展示文本；服务器标签用字典里的权威写法。 */
  label: string;
  /** 来源。 */
  source: TagSource;
  /** 服务器标签的字典 ID；作者标签恒为 null。 */
  tagId: string | null;
}

/** 解析结果：要么得到整篇文章的标签集合，要么给出稳定失败码。 */
export type TagResolution =
  | { ok: true; tags: ResolvedDocumentTag[] }
  | { ok: false; code: TagResolutionErrorCode; message: string };

/** 参与解析的字典行；隐藏条目不会出现在作者可选项里。 */
export interface ServerTagLike {
  id: string;
  slug: string;
  label: string;
  hidden?: boolean | undefined;
}

/** 去掉控制字符与零宽字符：它们肉眼不可见，却会让两个标签看起来一模一样。 */
function stripInvisible(value: string): string {
  return Array.from(value)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (code < 0x20 || code === 0x7f) return false;
      return !(code >= 0x200b && code <= 0x200f) && code !== 0xfeff;
    })
    .join("");
}

/**
 * 规范化作者输入的标签文本；非法输入返回 null。
 *
 * 规则：NFKC 归一（全角 `＃` 折成 `#`、全角空格折成半角）→ 去掉开头的 `#` 标记
 * → 折叠内部空白 → 去掉首尾空白。只去掉**开头**的 `#`，因此 `C#` 这类标签不会被截断。
 */
export function normalizeTagLabel(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const folded = stripInvisible(raw.normalize("NFKC"));
  const marked = folded.replace(/^[#\s]+/u, "").replace(/\s+/gu, " ").trim();
  if (!marked) return null;
  if (Array.from(marked).length > TAG_LABEL_MAX) return null;
  // 只有标点的标签会得到空 slug，无法作为稳定键，直接判为非法。
  if (!tagSlug(marked)) return null;
  return marked;
}

/**
 * 计算标签的稳定对比键。
 *
 * 大小写不敏感、空白等价（``雾 港`` 与 ``雾-港`` 同键），因此在同一篇文章里
 * 不会出现两个仅大小写不同的标签。
 */
export function tagSlug(label: string): string {
  const slug = label
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_]+/gu, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return Array.from(slug).slice(0, TAG_SLUG_MAX).join("");
}

/**
 * 把作者提交的标签文本解析成整篇文章的标签集合。
 *
 * - 文本命中**未隐藏**的字典条目时归为服务器标签（来源与写法都取字典），
 *   因此作者手打服务器标签名不会产生重复的自建标签；
 * - 其余归为作者标签，只属于这篇文章；
 * - 重复标签按 slug 去重，保留第一次出现的顺序。
 */
export function resolveDocumentTags(
  labels: readonly string[],
  dictionary: readonly ServerTagLike[],
): TagResolution {
  // 上限按去重后的结果算：重复输入同一个标签不算超限，也不会被提前拒绝。
  const visible = new Map<string, ServerTagLike>();
  for (const tag of dictionary) {
    if (tag.hidden) continue;
    const key = tagSlug(tag.label) || tag.slug;
    if (!visible.has(key)) visible.set(key, tag);
  }
  const tags: ResolvedDocumentTag[] = [];
  const seen = new Set<string>();
  for (const raw of labels) {
    const label = normalizeTagLabel(raw);
    if (!label) {
      return {
        ok: false,
        code: "TAG_LABEL_INVALID",
        message: `标签「${raw.trim()}」不合法：1-${TAG_LABEL_MAX} 个字符，且不能只有标点`,
      };
    }
    const key = tagSlug(label);
    if (seen.has(key)) continue;
    seen.add(key);
    const server = visible.get(key);
    tags.push(
      server
        ? { slug: server.slug, label: server.label, source: "server", tagId: server.id }
        : { slug: key, label, source: "author", tagId: null },
    );
    if (tags.length > TAG_LIMIT) {
      return {
        ok: false,
        code: "TAG_LIMIT_EXCEEDED",
        message: `一篇文章最多 ${TAG_LIMIT} 个标签`,
      };
    }
  }
  return { ok: true, tags };
}
