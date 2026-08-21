import { describe, expect, it } from 'vitest'

import { splitChapters } from './chapter-splitter.js'

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
})
