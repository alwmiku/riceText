import { describe, expect, it } from 'vitest'

import { MAX_CHAPTER_LENGTH, splitChapters, splitChaptersByStyle } from './chapter-splitter.js'

describe('splitChapters', () => {
  it('splits Chinese chapter headings', () => {
    const text = '第一章 相遇\n正文一\n第二章 离别\n正文二'
    const chapters = splitChapters(text)
    expect(chapters).toHaveLength(2)
    expect(chapters[0]).toMatchObject({ title: '第一章 相遇', text: '正文一' })
    expect(chapters[1]).toMatchObject({ title: '第二章 离别', text: '正文二' })
  })

  it('returns a single unnamed chapter when no heading is found', () => {
    const chapters = splitChapters('只是一段没有章节标题的文字')
    expect(chapters).toHaveLength(1)
    expect(chapters[0]?.title).toBe('未命名章节')
  })

  it('recognizes only the selected heading style', () => {
    const chapters = splitChaptersByStyle('第一章 忽略\n正文\nChapter 1 Keep\nbody', 'english')
    expect(chapters).toHaveLength(1)
    expect(chapters[0]).toMatchObject({ title: 'Chapter 1 Keep', text: 'body' })
  })

  it('splits oversized chapters locally at the upload boundary', () => {
    const source = `第一章 长章\n${'字'.repeat(MAX_CHAPTER_LENGTH + 12)}`
    const chapters = splitChaptersByStyle(source)
    expect(chapters).toHaveLength(2)
    expect(chapters.every((chapter) => chapter.text.length <= MAX_CHAPTER_LENGTH)).toBe(true)
    expect(chapters[1]?.title).toBe('第一章 长章（续2）')
  })
})
