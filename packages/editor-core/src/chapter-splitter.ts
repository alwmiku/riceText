/** 章节切分结果。 */
export interface ChapterSplit {
  /** 章节标题，例如“第一章 潮汐”。 */
  title: string
  /** 章节正文（不含标题行）。 */
  text: string
  /** 在原文本中的起始偏移。 */
  start: number
  /** 在原文本中的结束偏移。 */
  end: number
}

/** 章节切分选项。 */
export interface ChapterSplitOptions {
  /** 自定义章节标题正则；默认支持常见中文/英文章节格式。 */
  patterns?: RegExp[]
}

const defaultPatterns: RegExp[] = [
  /^第[0-9一二三四五六七八九十百千万零两]+[章节回卷].*$/gm,
  /^Chapter\s+\d+.*$/gim,
  /^\d+\s*[、.．]\s*\S.*$/gm,
]

/**
 * 将长篇纯文本按章节标题切分。
 *
 * 默认使用 TypeScript 实现；后续可替换为 C++/WASM 适配器。
 */
export function splitChapters(
  text: string,
  options: ChapterSplitOptions = {},
): ChapterSplit[] {
  const patterns = options.patterns ?? defaultPatterns
  const matches: Array<{ index: number; title: string }> = []

  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      matches.push({ index: match.index, title: match[0].trim() })
      if (match.index === regex.lastIndex) regex.lastIndex += 1
    }
  }

  matches.sort((a, b) => a.index - b.index)

  const result: ChapterSplit[] = []
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i]!.index
    const end = i + 1 < matches.length ? matches[i + 1]!.index : text.length
    const title = matches[i]!.title
    const body = text.slice(start + title.length, end).trim()
    result.push({ title, text: body, start, end })
  }

  if (result.length === 0 && text.trim()) {
    result.push({ title: '未命名章节', text: text.trim(), start: 0, end: text.length })
  }

  return result
}
