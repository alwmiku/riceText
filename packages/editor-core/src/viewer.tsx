import { EditorContent, useEditor } from '@tiptap/react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useEffect, useMemo, useRef } from 'react'

import { sanitizeDocument, sanitizeUrl } from './sanitize.js'
import { useRichTextViewerController } from './viewer/controller.js'
import { ImageLightbox } from './viewer/lightbox.js'
import { createViewerExtensions } from './extensions/viewer.js'
import {
  addMissingParagraphAnchors,
  collectGallery,
  extractHeadings,
  getEditorViewDom,
  projectReplyGates,
} from './viewer/prepare.js'
import {
  defaultLabels,
  type RichTextViewerProps,
  type ViewerContext,
  type ViewerContextRef,
} from './viewer/types.js'

export type {
  RichTextViewerController,
  RichTextViewerInteractions,
  RichTextViewerLabels,
  RichTextViewerProps,
  ViewerLightboxState,
  ViewerTocItem,
} from './viewer/types.js'
export { createViewerExtensions } from './extensions/viewer.js'
export { useRichTextViewerController } from './viewer/controller.js'
export { extractHeadings } from './viewer/prepare.js'

/**
 * 使用只读的 Tiptap/ProseMirror 编辑器渲染净化后的 Tiptap JSON。
 * 自定义节点使用 React NodeView，以便查看器交互持续生效。
 */
export function RichTextViewer({ content, className = '', interactions = {}, controller: externalController, enableLightbox = true, labels: labelOverrides = {}, onTocChange }: RichTextViewerProps) {
  const document = useMemo(
    () => addMissingParagraphAnchors(projectReplyGates(sanitizeDocument(content), interactions)),
    [content, interactions],
  )
  // 只随投影文档的“实际内容”重建编辑器：interactions 等调用方对象可能每次渲染
  // 都是新引用（如默认空对象），但投影结果不变时不应销毁重建编辑器，
  // 否则会触发 Tiptap 的无限重建与“Maximum update depth exceeded”。
  const documentKey = JSON.stringify(document)
  const gallery = useMemo(() => collectGallery(document), [document])
  const tocItems = useMemo(() => extractHeadings(document), [document])
  useEffect(() => {
    onTocChange?.(tocItems)
  }, [onTocChange, tocItems])
  const internalController = useRichTextViewerController(gallery.images.length)
  const controller = externalController ?? internalController
  const labels = useMemo(
    () => ({ ...defaultLabels, ...labelOverrides }),
    [labelOverrides],
  )
  const viewerContext = useMemo<ViewerContext>(() => ({
    interactions,
    controller,
    labels,
    enableLightbox,
    galleryImages: gallery.images,
  }), [interactions, controller, labels, enableLightbox, gallery.images])
  // 稳定 ref 容器：节点视图订阅它，在外部交互状态变化时重新渲染。
  const viewerContextRef = useMemo<ViewerContextRef & { notify: () => void }>(() => {
    const listeners = new Set<() => void>()
    return {
      current: viewerContext,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      notify: () => {
        for (const listener of listeners) listener()
      },
    }
  }, [])
  useEffect(() => {
    viewerContextRef.current = viewerContext
    viewerContextRef.notify()
  }, [viewerContext, viewerContextRef])
  const extensions = useMemo(
    () => createViewerExtensions(viewerContextRef),
    [viewerContextRef],
  )
  // 只随投影文档重建编辑器：interactions/labels/enableLightbox 都经由
  // viewerContextRef 进入节点视图，不参与编辑器实例的生命周期；
  // 否则默认空 interactions 对象每次渲染都是新引用，会触发无限重建。
  const editor = useEditor({
    extensions,
    content: document,
    editable: false,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
  }, [documentKey])
  const rootRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!editor) return undefined
    const tagHeadings = () => {
      const dom = getEditorViewDom(editor)
      if (!dom) return
      // 按文档顺序给非空标题打索引标记，与 extractHeadings 的目录条目保持一致。
      let tocIndex = 0
      dom.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((heading) => {
        if (!(heading.textContent ?? '').trim()) return
        heading.setAttribute('data-toc-index', String(tocIndex))
        tocIndex += 1
      })
    }
    tagHeadings()
    editor.on('create', tagHeadings)
    return () => {
      editor.off('create', tagHeadings)
    }
  }, [editor, document])

  useEffect(() => {
    if (!editor) return undefined
    const dom = getEditorViewDom(editor)
    if (!dom) return undefined

    const handleClick = (event: MouseEvent) => {
      const current = viewerContextRef.current
      const target = event.target as HTMLElement
      const link = target.closest('a')
      if (link?.getAttribute('href')) {
        const href = link.getAttribute('href')!
        // 渲染期二次白名单（防御纵深）：即使存储内容绕过服务端与查看器的
        // 整篇净化，javascript: 等危险协议也绝不会触发任何导航/脚本执行。
        if (sanitizeUrl(href, 'link') === null) {
          event.preventDefault()
          return
        }
        current.interactions.onLinkActivate?.(href, event as unknown as ReactMouseEvent<HTMLAnchorElement>)
        // 宿主没有接管链接时放行浏览器原生跳转（renderHTML 已输出
        // target=_blank + rel=noopener noreferrer nofollow）；
        // 宿主接管时保持拦截，由回调决定是否继续阻止默认行为。
        if (current.interactions.onLinkActivate !== undefined && !event.defaultPrevented) {
          event.preventDefault()
        }
        return
      }

      const spoiler = target.closest<HTMLElement>('[data-spoiler="true"]')
      if (spoiler) {
        let pos: number
        try {
          pos = editor.view.posAtDOM(spoiler, 0) ?? 0
        } catch {
          pos = 0
        }
        const key = `spoiler:${pos}`
        const next = !current.controller.revealedSpoilers.has(key)
        current.controller.toggleSpoiler(key)
        spoiler.classList.toggle('rt-spoiler--revealed', next)
        spoiler.setAttribute('aria-expanded', String(next))
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const target = event.target as HTMLElement
      const spoiler = target.closest<HTMLElement>('[data-spoiler="true"]')
      if (!spoiler) return
      event.preventDefault()
      const current = viewerContextRef.current
      let pos: number
      try {
        pos = editor.view.posAtDOM(spoiler, 0) ?? 0
      } catch {
        pos = 0
      }
      const key = `spoiler:${pos}`
      const next = !current.controller.revealedSpoilers.has(key)
      current.controller.toggleSpoiler(key)
      spoiler.classList.toggle('rt-spoiler--revealed', next)
      spoiler.setAttribute('aria-expanded', String(next))
    }

    dom.addEventListener('click', handleClick)
    dom.addEventListener('keydown', handleKeyDown)
    return () => {
      dom.removeEventListener('click', handleClick)
      dom.removeEventListener('keydown', handleKeyDown)
    }
  }, [editor, document])

  if (!editor) {
    return <article ref={rootRef} className={`rt-viewer ${className}`} />
  }

  return (
    <>
      <article ref={rootRef} className={`rt-viewer ${className}`}>
        <EditorContent editor={editor} />
      </article>
      {enableLightbox ? <ImageLightbox controller={controller} images={gallery.images} labels={labels} /> : null}
    </>
  )
}
