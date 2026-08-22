import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useEffect, useMemo, useRef } from 'react'

import { sanitizeDocument } from './sanitize.js'
import { useRichTextViewerController } from './viewer/controller.js'
import { ImageLightbox } from './viewer/lightbox.js'
import { createViewerExtensions } from './viewer/node-views.js'
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
} from './viewer/types.js'

export type {
  RichTextViewerController,
  RichTextViewerInteractions,
  RichTextViewerLabels,
  RichTextViewerProps,
  ViewerLightboxState,
  ViewerTocItem,
} from './viewer/types.js'
export { useRichTextViewerController } from './viewer/controller.js'
export { extractHeadings } from './viewer/prepare.js'

/**
 * Renders sanitized Tiptap JSON with a read-only Tiptap/ProseMirror editor.
 * Custom nodes use React NodeViews so viewer interactions keep working.
 */
export function RichTextViewer({ content, className = '', interactions = {}, controller: externalController, enableLightbox = true, labels: labelOverrides = {}, onTocChange }: RichTextViewerProps) {
  const document = useMemo(
    () => addMissingParagraphAnchors(projectReplyGates(sanitizeDocument(content), interactions)),
    [content, interactions],
  )
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
  const viewerContextRef = useRef<ViewerContext>(viewerContext)
  useEffect(() => {
    viewerContextRef.current = viewerContext
  }, [viewerContext])
  const extensions = useMemo(
    () => createViewerExtensions(viewerContextRef),
    [viewerContextRef],
  )
  const editor = useEditor({
    extensions,
    content: document,
    editable: false,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
  }, [document, interactions, labels, enableLightbox])
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
        current.interactions.onLinkActivate?.(href, event as unknown as ReactMouseEvent<HTMLAnchorElement>)
        if (!event.defaultPrevented) event.preventDefault()
        return
      }

      const spoiler = target.closest<HTMLElement>('[data-spoiler="true"]')
      if (spoiler) {
        let pos = 0
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
      let pos = 0
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
