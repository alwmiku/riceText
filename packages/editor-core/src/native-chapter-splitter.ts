import { createRequire } from 'node:module'

import type {
  ChapterSplit,
  ChapterSplitOptions,
  ChapterSplitterAdapter,
} from './chapter-splitter.js'

/**
 * C++ Addon 返回的原生章节切分结果。
 * 与 `ChapterSplit` 保持一致，方便上层直接使用。
 */
interface NativeChapterSplit {
  title: string
  text: string
  start: number
  end: number
}

interface NativeChapterSplitterModule {
  split(text: string, patternSources?: string[]): NativeChapterSplit[]
}

const require = createRequire(import.meta.url)

/**
 * 尝试加载本地 C++ Addon。
 *
 * 期望构建产物位于：
 *   packages/editor-core/native/chapter-splitter.node
 *
 * 如果不存在或加载失败，返回 `null`，上层会回退到 TypeScript 实现。
 */
export function loadNativeChapterSplitterAdapter(): ChapterSplitterAdapter | null {
  try {
    const native = require('../native/chapter-splitter.node') as NativeChapterSplitterModule

    return {
      async split(
        text: string,
        options: ChapterSplitOptions = {},
      ): Promise<ChapterSplit[]> {
        const patternSources = options.patterns?.map((pattern) => pattern.source)
        const result = native.split(text, patternSources)
        return result.map((item) => ({
          title: item.title,
          text: item.text,
          start: item.start,
          end: item.end,
        }))
      },
    }
  } catch {
    return null
  }
}
