/** 章节切分结果。 */
export interface ChapterSplit {
  /** 章节标题，例如“第一章 潮汐”。 */
  title: string;
  /** 章节正文（不含标题行）。 */
  text: string;
  /** 在原文本中的起始偏移。 */
  start: number;
  /** 在原文本中的结束偏移。 */
  end: number;
}

/** 章节切分选项。 */
export interface ChapterSplitOptions {
  /** 自定义章节标题正则；默认支持常见中文/英文章节格式。 */
  patterns?: RegExp[];
}

/** 单章正文最大字符数；上传和本地编辑都以此为边界。 */
export const MAX_CHAPTER_LENGTH = 50_000;

/** 支持的章节标题风格。 */
export type ChapterTitleStyle = "auto" | "chinese" | "english" | "numeric";

/** 章节标题样式对应的识别规则。 */
export const chapterTitlePatterns: Record<
  Exclude<ChapterTitleStyle, "auto">,
  RegExp[]
> = {
  chinese: [/^第[0-9一二三四五六七八九十百千万零两]+[章节回卷].*$/gm],
  english: [/^Chapter\s+\d+.*$/gim],
  numeric: [/^\d+\s*[、.．]\s*\S.*$/gm],
};

const defaultPatterns = Object.values(chapterTitlePatterns).flat();

/** 按自然换行优先切开超长正文，避免一章超过上传限制。 */
function splitOversizedChapter(chapter: ChapterSplit): ChapterSplit[] {
  if (chapter.text.length <= MAX_CHAPTER_LENGTH) return [chapter];

  const parts: ChapterSplit[] = [];
  let remaining = chapter.text;
  let offset = chapter.start + chapter.title.length;
  let continuation = 1;

  while (remaining.length > MAX_CHAPTER_LENGTH) {
    const window = remaining.slice(0, MAX_CHAPTER_LENGTH + 1);
    const newline = window.lastIndexOf("\n");
    const cutAt = newline > MAX_CHAPTER_LENGTH / 2 ? newline + 1 : MAX_CHAPTER_LENGTH;
    const body = remaining.slice(0, cutAt).trim();
    parts.push({
      title: continuation === 1 ? chapter.title : `${chapter.title}（续${continuation}）`,
      text: body,
      start: offset,
      end: offset + cutAt,
    });
    offset += cutAt;
    remaining = remaining.slice(cutAt);
    continuation += 1;
  }

  parts.push({
    title: continuation === 1 ? chapter.title : `${chapter.title}（续${continuation}）`,
    text: remaining.trim(),
    start: offset,
    end: chapter.end,
  });
  return parts;
}

/** 以指定风格切分长文本，并保证每章不超过最大字符数。 */
export function splitChaptersByStyle(
  text: string,
  style: ChapterTitleStyle = "auto",
): ChapterSplit[] {
  const patterns =
    style === "auto" ? defaultPatterns : chapterTitlePatterns[style];
  return splitChapters(text, { patterns }).flatMap(splitOversizedChapter);
}


/** 章节切分适配器，后续可替换为 C++ Addon / WASM / 独立服务。 */
export interface ChapterSplitterAdapter {
  split(text: string, options: ChapterSplitOptions): Promise<ChapterSplit[]>;
}

/** 默认 TypeScript 章节切分适配器。 */
export const defaultChapterSplitterAdapter: ChapterSplitterAdapter = {
  async split(text, options) {
    return splitChapters(text, options);
  },
};

let activeChapterSplitterAdapter: ChapterSplitterAdapter =
  defaultChapterSplitterAdapter;

/** 注册自定义章节切分适配器，例如 C++ Addon / WASM / 独立服务。 */
export function setChapterSplitterAdapter(
  adapter: ChapterSplitterAdapter,
): void {
  activeChapterSplitterAdapter = adapter;
}

/** 获取当前章节切分适配器。 */
export function getChapterSplitterAdapter(): ChapterSplitterAdapter {
  return activeChapterSplitterAdapter;
}

/** 使用当前适配器执行章节切分。 */
export async function splitChaptersWithAdapter(
  text: string,
  options: ChapterSplitOptions = {},
): Promise<ChapterSplit[]> {
  return activeChapterSplitterAdapter.split(text, options);
}

/** 章节级增量操作。 */
export type ChapterOp =
  | { type: "insert"; text: string }
  | { type: "delete"; count: number }
  | { type: "retain"; count: number };

/** 章节级增量更新结构。 */
export interface ChapterDelta {
  chapterId: string;
  ops: ChapterOp[];
}

/**
 * 将长篇纯文本按章节标题切分。
 *
 * 默认使用 TypeScript 实现；后续可替换为 C++/WASM 适配器。
 */
export function splitChapters(
  text: string,
  options: ChapterSplitOptions = {},
): ChapterSplit[] {
  const patterns = options.patterns ?? defaultPatterns;
  const matches: Array<{ index: number; title: string }> = [];

  for (const pattern of patterns) {
    const regex = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
    );
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      matches.push({ index: match.index, title: match[0].trim() });
      if (match.index === regex.lastIndex) regex.lastIndex += 1;
    }
  }

  matches.sort((a, b) => a.index - b.index);

  const result: ChapterSplit[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i]!.index;
    const end = i + 1 < matches.length ? matches[i + 1]!.index : text.length;
    const title = matches[i]!.title;
    const body = text.slice(start + title.length, end).trim();
    result.push({ title, text: body, start, end });
  }

  if (result.length === 0 && text.trim()) {
    result.push({
      title: "未命名章节",
      text: text.trim(),
      start: 0,
      end: text.length,
    });
  }

  return result;
}
