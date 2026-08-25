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
  /** 标题行（含行首空白）在原文本中的结束偏移。 */
  titleEnd?: number;
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

/** 判断一行文本是否像站点广告/推广（不应作为章节标题）。 */
export function isAdHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length > 60) return true;
  if (/https?:\/\//i.test(trimmed)) return true;
  if (/www\./i.test(trimmed)) return true;
  if (/\.(com|net|org|cn|cc|info|top|xyz|vip|me)\b/i.test(trimmed)) return true;
  if (
    /免费阅读|最新章节|手机阅读|全文阅读|无弹窗|txt下载|更新通知|小说阅读/.test(
      trimmed,
    )
  )
    return true;
  return false;
}

/** 章节标题样式对应的识别规则。 */
export const chapterTitlePatterns: Record<
  Exclude<ChapterTitleStyle, "auto">,
  RegExp[]
> = {
  chinese: [
    /^\s*第[0-9一二三四五六七八九十百千万零两]+[章节回卷](?:\s|[：:、.．《（(]|$).*$/gm,
  ],
  english: [/^\s*Chapter\s+\d+.*$/gim],
  numeric: [/^\s*\d+\s*[、.．]\s*\S.*$/gm],
};

const defaultPatterns = Object.values(chapterTitlePatterns).flat();

/** 按自然换行优先切开超长正文，避免一章超过上传限制；区间基于原文偏移。 */
function splitOversizedChapter(
  chapter: ChapterSplit,
  source: string,
): ChapterSplit[] {
  if (chapter.text.length <= MAX_CHAPTER_LENGTH) return [chapter];

  const bodyStart = chapter.titleEnd ?? chapter.start;
  const rawBody = source.slice(bodyStart, chapter.end);
  const parts: ChapterSplit[] = [];
  let offset = bodyStart;
  let remaining = rawBody;
  let continuation = 1;

  while (remaining.length > MAX_CHAPTER_LENGTH) {
    const window = remaining.slice(0, MAX_CHAPTER_LENGTH + 1);
    const newline = window.lastIndexOf("\n");
    const cutAt =
      newline > MAX_CHAPTER_LENGTH / 2 ? newline + 1 : MAX_CHAPTER_LENGTH;
    parts.push({
      title:
        continuation === 1
          ? chapter.title
          : `${chapter.title}（续${continuation}）`,
      text: remaining.slice(0, cutAt).trim(),
      start: continuation === 1 ? chapter.start : offset,
      end: offset + cutAt,
    });
    offset += cutAt;
    remaining = remaining.slice(cutAt);
    continuation += 1;
  }

  parts.push({
    title:
      continuation === 1
        ? chapter.title
        : `${chapter.title}（续${continuation}）`,
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
  const chapters = splitChapters(text, { patterns });
  const scopedChapters =
    style === "auto" || chapters[0]?.title !== "卷首"
      ? chapters
      : chapters.slice(1);
  return scopedChapters.flatMap((chapter) =>
    splitOversizedChapter(chapter, text),
  );
}

/**
 * 将长篇纯文本按章节标题切分。
 */
export function splitChapters(
  text: string,
  options: ChapterSplitOptions = {},
): ChapterSplit[] {
  const patterns = options.patterns ?? defaultPatterns;
  const matches: Array<{
    index: number;
    title: string;
    titleEnd: number;
  }> = [];

  for (const pattern of patterns) {
    const regex = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
    );
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (isAdHeadingLine(match[0])) {
        if (match.index === regex.lastIndex) regex.lastIndex += 1;
        continue;
      }
      matches.push({
        index: match.index,
        title: match[0].trim(),
        titleEnd: match.index + match[0].length,
      });
      if (match.index === regex.lastIndex) regex.lastIndex += 1;
    }
  }

  matches.sort((a, b) => a.index - b.index);

  const result: ChapterSplit[] = [];
  // 第一个标题之前的内容（如开头的番外、序言）不能丢失：作为“卷首”章节保留，
  // 番外/序/楔子等附加内容不做自动切分，由用户在原文对照中手动切分。
  if (matches.length > 0 && matches[0]!.index > 0) {
    const trimmedLead = text.slice(0, matches[0]!.index).trim();
    if (trimmedLead) {
      result.push({
        title: "卷首",
        text: trimmedLead,
        start: 0,
        end: matches[0]!.index,
      });
    }
  }

  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i]!.index;
    const end = i + 1 < matches.length ? matches[i + 1]!.index : text.length;
    const title = matches[i]!.title;
    const titleEnd = matches[i]!.titleEnd;
    const body = text.slice(titleEnd, end).trim();
    result.push({ title, text: body, start, end, titleEnd });
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
