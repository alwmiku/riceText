import type { JSONContent, Extensions, Editor } from '@tiptap/core'
import {
  EditorContent,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from '@tiptap/react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, WheelEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  AttachmentRef,
  DiceRoll,
  InlineCommentAnchor,
  Mention,
  NovelExcerpt,
  PollRef,
  ReplyGate,
  RichImage,
  Spoiler,
  editorExtensions,
} from './extensions.js'
import { sanitizeDocument } from './sanitize.js'
import { PollResultChart } from './poll-result-chart.js'
import type {
  AttachmentReferenceAttributes,
  DiceRollAttributes,
  InlineCommentAnchorAttributes,
  MentionAttributes,
  NovelExcerptAttributes,
  PollReferenceAttributes,
  ReplyGateAttributes,
  RichImageAttributes,
  ViewerAttachmentState,
  ViewerImage,
  ViewerPollState,
} from './types.js'

/** Current full-screen image viewer state. */
export interface ViewerLightboxState {
  /** Selected image index, or `null` while the lightbox is closed. */
  index: number | null
  /** Zoom scale clamped between 0.5 and 4. */
  zoom: number
  /** Horizontal pan displacement in CSS pixels. */
  offsetX: number
  /** Vertical pan displacement in CSS pixels. */
  offsetY: number
}

/** Interaction controller returned by {@link useRichTextViewerController}. */
export interface RichTextViewerController {
  /** Current lightbox transform and selection. */
  lightbox: ViewerLightboxState
  /** Spoiler render keys explicitly revealed on touch or click. */
  revealedSpoilers: ReadonlySet<string>
  /** Opens an image by gallery index. */
  openImage: (index: number) => void
  /** Closes the full-screen image viewer. */
  closeImage: () => void
  /** Selects the previous image, wrapping at the start. */
  previousImage: () => void
  /** Selects the next image, wrapping at the end. */
  nextImage: () => void
  /** Adds a zoom delta while retaining the current pan. */
  changeZoom: (delta: number) => void
  /** Resets zoom and pan for the current image. */
  resetTransform: () => void
  /** Adds a drag displacement to the current pan. */
  panBy: (deltaX: number, deltaY: number) => void
  /** Reveals or hides one spoiler instance. */
  toggleSpoiler: (key: string) => void
}

/** Application callbacks and hydrated state used by the static viewer. */
export interface RichTextViewerInteractions {
  /** Loads or opens the selected inline-comment thread. */
  onInlineCommentActivate?: (attrs: InlineCommentAnchorAttributes) => void
  /** Explicitly requests a new persisted result for a dice roll. */
  onDiceReroll?: (attrs: DiceRollAttributes) => void
  /** Opens a user profile or mention action. */
  onMentionActivate?: (attrs: MentionAttributes) => void
  /** Renders detailed mention content shown on hover and keyboard focus. */
  renderMentionCard?: (attrs: MentionAttributes) => ReactNode
  /** Returns whether the current identity may see a gated block. */
  isReplyGateVisible?: (attrs: ReplyGateAttributes) => boolean
  /** Starts the reply or sign-in flow required to reveal a gated block. */
  onReplyGateRequest?: (attrs: ReplyGateAttributes) => void
  /** Returns hydrated ownership and pending state for an attachment. */
  getAttachmentState?: (attrs: AttachmentReferenceAttributes) => ViewerAttachmentState
  /** Purchases or downloads the selected attachment. */
  onAttachmentActivate?: (attrs: AttachmentReferenceAttributes) => void
  /** Returns current vote totals, selection, permission, and pending state. */
  getPollState?: (attrs: PollReferenceAttributes) => ViewerPollState
  /** Submits the complete current poll selection after the user confirms. */
  onPollSubmit?: (attrs: PollReferenceAttributes, optionIds: readonly string[]) => void
  /** Legacy single-option vote callback used when no submit callback is supplied. */
  onPollVote?: (attrs: PollReferenceAttributes, optionId: string) => void
  /** Observes an image being opened in the full-screen gallery. */
  onImageOpen?: (image: ViewerImage) => void
  /** Observes activation of a safe document link. */
  onLinkActivate?: (href: string, event: ReactMouseEvent<HTMLAnchorElement>) => void
}

/** Localized text used by viewer-only controls. */
export interface RichTextViewerLabels {
  /** Accessible label for an inline-comment counter. */
  inlineComments: string
  /** Accessible label for explicit dice reroll. */
  rerollDice: string
  /** Text for a free attachment action. */
  download: string
  /** Text for a paid attachment action. */
  purchase: string
  /** Currency unit appended to attachment prices. */
  coins: string
  /** Poll vote unit appended to totals. */
  votes: string
  /** Label for the optional novel excerpt source link. */
  source: string
  /** Lightbox close control. */
  closeImage: string
  /** Lightbox previous-image control. */
  previousImage: string
  /** Lightbox next-image control. */
  nextImage: string
  /** Lightbox zoom-in control. */
  zoomIn: string
  /** Lightbox zoom-out control. */
  zoomOut: string
  /** Lightbox reset control. */
  resetZoom: string
}

/** Props for the static, non-editable rich-text renderer. */
export interface RichTextViewerProps {
  /** Tiptap JSON to sanitize and render. */
  content: JSONContent
  /** Additional class applied to the viewer root. */
  className?: string
  /** Application callbacks and externally hydrated feature state. */
  interactions?: RichTextViewerInteractions
  /** Optional externally owned viewer controller. */
  controller?: RichTextViewerController
  /** Whether rich images open in the built-in lightbox. Defaults to `true`. */
  enableLightbox?: boolean
  /** Overrides individual control labels. */
  labels?: Partial<RichTextViewerLabels>
  /** Receives headings extracted from the projected document for a sidebar TOC. */
  onTocChange?: (items: ViewerTocItem[]) => void
}

const defaultLabels: RichTextViewerLabels = {
  inlineComments: 'Open inline comments', rerollDice: 'Reroll dice', download: 'Download', purchase: 'Purchase', coins: 'coins', votes: 'votes',
  source: 'Source', closeImage: 'Close image', previousImage: 'Previous image', nextImage: 'Next image', zoomIn: 'Zoom in', zoomOut: 'Zoom out', resetZoom: 'Reset zoom',
}

/**
 * Owns spoiler disclosure and full-screen gallery state without instantiating a
 * Tiptap editor. The controller can be shared with surrounding application UI.
 */
export function useRichTextViewerController(imageCount: number): RichTextViewerController {
  const [lightbox, setLightbox] = useState<ViewerLightboxState>({ index: null, zoom: 1, offsetX: 0, offsetY: 0 })
  const [revealedSpoilers, setRevealedSpoilers] = useState<ReadonlySet<string>>(() => new Set())
  const reset = useCallback((index: number | null) => setLightbox({ index, zoom: 1, offsetX: 0, offsetY: 0 }), [])
  const openImage = useCallback((index: number) => {
    if (imageCount > 0) reset(Math.min(imageCount - 1, Math.max(0, index)))
  }, [imageCount, reset])
  const closeImage = useCallback(() => reset(null), [reset])
  const previousImage = useCallback(() => setLightbox((value) => ({
    index: value.index === null || imageCount === 0 ? null : (value.index - 1 + imageCount) % imageCount,
    zoom: 1, offsetX: 0, offsetY: 0,
  })), [imageCount])
  const nextImage = useCallback(() => setLightbox((value) => ({
    index: value.index === null || imageCount === 0 ? null : (value.index + 1) % imageCount,
    zoom: 1, offsetX: 0, offsetY: 0,
  })), [imageCount])
  const changeZoom = useCallback((delta: number) => setLightbox((value) => ({ ...value, zoom: Math.min(4, Math.max(0.5, value.zoom + delta)) })), [])
  const resetTransform = useCallback(() => setLightbox((value) => ({ ...value, zoom: 1, offsetX: 0, offsetY: 0 })), [])
  const panBy = useCallback((deltaX: number, deltaY: number) => setLightbox((value) => ({ ...value, offsetX: value.offsetX + deltaX, offsetY: value.offsetY + deltaY })), [])
  const toggleSpoiler = useCallback((key: string) => setRevealedSpoilers((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }), [])

  useEffect(() => {
    if (lightbox.index !== null && lightbox.index >= imageCount) reset(imageCount > 0 ? imageCount - 1 : null)
  }, [imageCount, lightbox.index, reset])
  return { lightbox, revealedSpoilers, openImage, closeImage, previousImage, nextImage, changeZoom, resetTransform, panBy, toggleSpoiler }
}

interface GalleryData {
  images: ViewerImage[]
}

/** 单次遍历收集图片，保证正文顺序就是灯箱前后顺序。 */
function collectGallery(document: JSONContent): GalleryData {
  const images: ViewerImage[] = []
  const visit = (node: JSONContent) => {
    if (node.type === 'richImage') {
      const attrs = node.attrs as unknown as RichImageAttributes
      images.push({ ...attrs, index: images.length })
    }
    node.content?.forEach(visit)
  }
  visit(document)
  return { images }
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

/** 为没有行末间贴锚点的非空段落补一个自动锚点，保持阅读模式的气泡体验。 */
function addMissingParagraphAnchors(doc: JSONContent): JSONContent {
  const clone = structuredClone(doc)
  const visit = (node: JSONContent, path: string, insideReplyGate = false): void => {
    const nextInsideReplyGate = insideReplyGate || node.type === 'replyGate'
    if (node.type === 'paragraph' && !insideReplyGate) {
      const hasEndAnchor = node.content?.some((child) => child.type === 'inlineCommentAnchor' && child.attrs?.placement === 'end') ?? false
      const hasVisibleContent = node.content?.some((child) => child.type !== 'inlineCommentAnchor') ?? false
      if (!hasEndAnchor && hasVisibleContent) {
        node.content = [
          ...(node.content ?? []),
          { type: 'inlineCommentAnchor', attrs: { threadId: `auto:${path}`, count: 0, placement: 'end' } },
        ]
      }
    }
    node.content?.forEach((child, index) => visit(child, `${path}.${index}`, nextInsideReplyGate))
  }
  visit(clone, '0')
  return clone
}

/** Removes locked reply-gate children before ProseMirror constructs reader DOM. */
function projectReplyGates(doc: JSONContent, interactions: RichTextViewerInteractions): JSONContent {
  const clone = structuredClone(doc)
  const visit = (node: JSONContent): void => {
    if (node.type === 'replyGate') {
      const attrs = node.attrs as unknown as ReplyGateAttributes
      if (interactions.isReplyGateVisible?.(attrs) !== true) {
        node.content = [{ type: 'paragraph' }]
        return
      }
    }
    node.content?.forEach(visit)
  }
  visit(clone)
  return clone
}

/** Viewer-only context passed to every custom NodeView through a stable ref. */
interface ViewerContext {
  interactions: RichTextViewerInteractions
  controller: RichTextViewerController
  labels: RichTextViewerLabels
  enableLightbox: boolean
  galleryImages: readonly ViewerImage[]
}

/** Stable ref wrapper so NodeViews always read the latest viewer context. */
interface ViewerContextRef {
  current: ViewerContext
}

type ViewerNodeProps = Pick<NodeViewProps, 'node'> & { viewerRef: ViewerContextRef }
type ViewerRichImageNodeProps = Pick<NodeViewProps, 'node' | 'getPos' | 'editor'> & { viewerRef: ViewerContextRef }

function getRichImageIndex(editor: Editor, getPos: () => number | undefined): number {
  const currentPos = getPos()
  if (currentPos === undefined) return 0
  let index = 0
  let found = false
  editor.state.doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name === 'richImage') {
      if (pos === currentPos) {
        found = true
        return false
      }
      index += 1
    }
    return true
  })
  return found ? index : 0
}

function RichImageNodeView({ node, getPos, editor, viewerRef }: ViewerRichImageNodeProps) {
  const viewer = viewerRef.current
  const attrs = node.attrs as unknown as RichImageAttributes
  const index = getRichImageIndex(editor, getPos)
  const image = viewer.galleryImages[index]
  const open = () => {
    if (!viewer.enableLightbox || !image) return
    viewer.controller.openImage(index)
    viewer.interactions.onImageOpen?.(image)
  }
  return (
    <figure className={`rt-rich-image rt-rich-image--${attrs.align}`} style={{ width: `${attrs.width}%` }}>
      <button type="button" className="rt-rich-image__open" disabled={!viewer.enableLightbox} onClick={open} aria-label={attrs.alt || 'Open image'}>
        <img src={attrs.src} alt={attrs.alt} loading="lazy" />
      </button>
      {attrs.caption ? <figcaption>{attrs.caption}</figcaption> : null}
    </figure>
  )
}

function DiceRollNodeView({ node, viewerRef }: ViewerNodeProps) {
  const viewer = viewerRef.current
  const attrs = node.attrs as unknown as DiceRollAttributes
  const dice = (
    <span className="rt-dice-roll" title={attrs.rolls.join(' + ')}>
      <span>{attrs.expression}</span>
      <strong>= {attrs.total}</strong>
    </span>
  )
  return viewer.interactions.onDiceReroll ? (
    <button type="button" className="rt-dice-roll__button" title={viewer.labels.rerollDice} onClick={() => viewer.interactions.onDiceReroll?.(attrs)}>{dice}</button>
  ) : dice
}

function InlineCommentAnchorNodeView({ node, viewerRef }: ViewerNodeProps) {
  const viewer = viewerRef.current
  const attrs = node.attrs as unknown as InlineCommentAnchorAttributes
  const empty = attrs.count <= 0
  return (
    <button
      type="button"
      className={`rt-inline-comment-anchor rt-inline-comment-anchor--${attrs.placement}${empty ? ' rt-inline-comment-anchor--empty' : ''}`}
      data-node-type="inline-comment-anchor"
      data-thread-id={attrs.threadId}
      data-count={attrs.count}
      data-placement={attrs.placement}
      aria-label={`${viewer.labels.inlineComments}: ${attrs.count}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        viewer.interactions.onInlineCommentActivate?.(attrs)
      }}
    >
      {empty ? '' : attrs.count}
    </button>
  )
}

function MentionNodeView({ node, viewerRef }: ViewerNodeProps) {
  const viewer = viewerRef.current
  const attrs = node.attrs as unknown as MentionAttributes
  const interactive = Boolean(viewer.interactions.onMentionActivate)
  return (
    <span
      className={`rt-mention ${attrs.resolved ? 'rt-mention--resolved' : 'rt-mention--unresolved'}`}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={() => viewer.interactions.onMentionActivate?.(attrs)}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && interactive) viewer.interactions.onMentionActivate?.(attrs)
      }}
    >
      @{attrs.name}
      {viewer.interactions.renderMentionCard ? <span className="rt-mention__card">{viewer.interactions.renderMentionCard(attrs)}</span> : null}
    </span>
  )
}

function AttachmentNodeView({ node, viewerRef }: ViewerNodeProps) {
  const viewer = viewerRef.current
  const attrs = node.attrs as unknown as AttachmentReferenceAttributes
  const state = viewer.interactions.getAttachmentState?.(attrs) ?? { available: attrs.priceCoins === 0, pending: false }
  return (
    <button
      type="button"
      className="rt-attachment"
      disabled={state.pending || !viewer.interactions.onAttachmentActivate}
      onClick={() => viewer.interactions.onAttachmentActivate?.(attrs)}
    >
      <span className="rt-attachment__name">{attrs.name}</span>
      <small>{formatBytes(attrs.size)} · {attrs.mimeType}</small>
      <strong>{state.available ? viewer.labels.download : `${viewer.labels.purchase} · ${attrs.priceCoins} ${viewer.labels.coins}`}</strong>
    </button>
  )
}

function PollNodeView({ node, viewerRef }: ViewerNodeProps) {
  const viewer = viewerRef.current
  const attrs = node.attrs as unknown as PollReferenceAttributes
  const state = viewer.interactions.getPollState?.(attrs) ?? { selectedOptionIds: [], votesByOption: {}, canVote: true, pending: false }
  return (
    <section className="rt-poll" aria-labelledby={`poll-${attrs.pollId}`}>
      <h3 id={`poll-${attrs.pollId}`}>{attrs.question}</h3>
      <PollResultChart
        options={attrs.options.map((option) => ({
          id: option.id,
          label: option.label,
          votes: Math.max(0, state.votesByOption[option.id] ?? 0),
          selected: state.selectedOptionIds.includes(option.id),
          disabled: !state.canVote || state.pending || (!viewer.interactions.onPollVote && !viewer.interactions.onPollSubmit),
          multiple: attrs.multiple,
        }))}
        voteLabel={viewer.labels.votes}
        voted={state.selectedOptionIds.length > 0}
        groupName={`poll-${attrs.pollId}`}
        onVote={(optionId) => viewer.interactions.onPollVote?.(attrs, optionId)}
        onSubmit={(optionIds) => {
          if (viewer.interactions.onPollSubmit) {
            viewer.interactions.onPollSubmit(attrs, optionIds);
          } else {
            optionIds.forEach((optionId) => viewer.interactions.onPollVote?.(attrs, optionId));
          }
        }}
      />
    </section>
  )
}

function ReplyGateNodeView({ node, viewerRef }: ViewerNodeProps) {
  const viewer = viewerRef.current
  const attrs = node.attrs as unknown as ReplyGateAttributes
  const visible = viewer.interactions.isReplyGateVisible?.(attrs) === true
  if (!visible) {
    return (
      <NodeViewWrapper as="section" className="rt-reply-gate rt-reply-gate--locked">
        <button type="button" onClick={() => viewer.interactions.onReplyGateRequest?.(attrs)}>{attrs.prompt}</button>
      </NodeViewWrapper>
    )
  }
  return (
    <NodeViewWrapper as="section" className="rt-reply-gate rt-reply-gate--visible">
      <NodeViewContent />
    </NodeViewWrapper>
  )
}

function NovelExcerptNodeView({ node, viewerRef }: ViewerNodeProps) {
  const viewer = viewerRef.current
  const attrs = node.attrs as unknown as NovelExcerptAttributes
  return (
    <NodeViewWrapper as="aside" className={`rt-novel-excerpt rt-novel-excerpt--${attrs.variant}`}>
      <header>
        <strong>{attrs.bookTitle}</strong>
        <span>{attrs.chapterTitle}</span>
        <small>{attrs.author}</small>
      </header>
      <div className="rt-novel-excerpt__content">
        <NodeViewContent />
      </div>
      {attrs.sourceUrl ? (
        <a href={attrs.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">{viewer.labels.source}</a>
      ) : null}
    </NodeViewWrapper>
  )
}

/** Build a read-only Tiptap extension set with viewer NodeViews attached. */
function createViewerExtensions(viewerRef: ViewerContextRef): Extensions {
  return editorExtensions().map((extension) => {
    switch (extension.name) {
      case 'richImage':
        return RichImage.extend({
          addNodeView: () => ReactNodeViewRenderer(({ node, getPos, editor }) => (
            <RichImageNodeView node={node} getPos={getPos} editor={editor} viewerRef={viewerRef} />
          ), { trackNodeViewPosition: true }),
        })
      case 'diceRoll':
        return DiceRoll.extend({
          addNodeView: () => ReactNodeViewRenderer(({ node }) => <DiceRollNodeView node={node} viewerRef={viewerRef} />),
        })
      case 'inlineCommentAnchor':
        return InlineCommentAnchor.extend({
          addNodeView: () => ReactNodeViewRenderer(({ node }) => <InlineCommentAnchorNodeView node={node} viewerRef={viewerRef} />),
        })
      case 'mention':
        return Mention.extend({
          addNodeView: () => ReactNodeViewRenderer(({ node }) => <MentionNodeView node={node} viewerRef={viewerRef} />),
        })
      case 'attachmentRef':
        return AttachmentRef.extend({
          addNodeView: () => ReactNodeViewRenderer(({ node }) => <AttachmentNodeView node={node} viewerRef={viewerRef} />),
        })
      case 'pollRef':
        return PollRef.extend({
          addNodeView: () => ReactNodeViewRenderer(({ node }) => <PollNodeView node={node} viewerRef={viewerRef} />),
        })
      case 'replyGate':
        return ReplyGate.extend({
          addNodeView: () => ReactNodeViewRenderer(({ node }) => <ReplyGateNodeView node={node} viewerRef={viewerRef} />),
        })
      case 'novelExcerpt':
        return NovelExcerpt.extend({
          addNodeView: () => ReactNodeViewRenderer(({ node }) => <NovelExcerptNodeView node={node} viewerRef={viewerRef} />),
        })
      case 'spoiler':
        return Spoiler.extend({
          renderHTML() {
            return ['span', { class: 'rt-spoiler', 'data-spoiler': 'true', role: 'button', tabindex: '0', 'aria-expanded': 'false' }, 0]
          },
        })
      default:
        return extension
    }
  })
}

interface ImageLightboxProps {
  controller: RichTextViewerController
  images: readonly ViewerImage[]
  labels: RichTextViewerLabels
}

function ImageLightbox({ controller, images, labels }: ImageLightboxProps) {
  const drag = useRef<{ x: number; y: number } | null>(null)
  const index = controller.lightbox.index
  const image = index === null ? undefined : images[index]
  useEffect(() => {
    if (!image) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') controller.closeImage()
      if (event.key === 'ArrowLeft') controller.previousImage()
      if (event.key === 'ArrowRight') controller.nextImage()
      if (event.key === '+' || event.key === '=') controller.changeZoom(0.25)
      if (event.key === '-') controller.changeZoom(-0.25)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [controller, image])
  if (!image) return null

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || controller.lightbox.zoom <= 1) return
    controller.panBy(event.clientX - drag.current.x, event.clientY - drag.current.y)
    drag.current = { x: event.clientX, y: event.clientY }
  }
  const stopDrag = () => { drag.current = null }
  const onWheel = (event: WheelEvent<HTMLDivElement>) => { event.preventDefault(); controller.changeZoom(event.deltaY < 0 ? 0.25 : -0.25) }
  const transform = `translate(${controller.lightbox.offsetX}px, ${controller.lightbox.offsetY}px) scale(${controller.lightbox.zoom})`
  return (
    <div className="rt-lightbox" role="dialog" aria-modal="true" aria-label={image.alt || 'Image viewer'}>
      <div className="rt-lightbox__stage" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onWheel={onWheel}>
        <img src={image.src} alt={image.alt} draggable={false} style={{ transform }} />
      </div>
      <div className="rt-lightbox__toolbar">
        <button type="button" title={labels.closeImage} aria-label={labels.closeImage} onClick={controller.closeImage}>×</button>
        <button type="button" title={labels.previousImage} aria-label={labels.previousImage} onClick={controller.previousImage}>‹</button>
        <span>{(index ?? 0) + 1} / {images.length}</span>
        <button type="button" title={labels.nextImage} aria-label={labels.nextImage} onClick={controller.nextImage}>›</button>
        <button type="button" title={labels.zoomOut} aria-label={labels.zoomOut} onClick={() => controller.changeZoom(-0.25)}>−</button>
        <button type="button" title={labels.resetZoom} aria-label={labels.resetZoom} onClick={controller.resetTransform}>{Math.round(controller.lightbox.zoom * 100)}%</button>
        <button type="button" title={labels.zoomIn} aria-label={labels.zoomIn} onClick={() => controller.changeZoom(0.25)}>+</button>
      </div>
    </div>
  )
}

/** 由阅读器正文标题生成的目录条目。 */
export interface ViewerTocItem {
  /** 标题在正文中的文档顺序索引，用于 DOM 定位。 */
  index: number
  /** 标题级别（1–6）。 */
  level: number
  /** 标题可见文本。 */
  text: string
}

/** 按正文顺序收集标题，供目录快速跳转。 */
export function extractHeadings(doc: JSONContent): ViewerTocItem[] {
  const items: ViewerTocItem[] = []
  const visit = (node: JSONContent): void => {
    if (typeof node.type === 'string' && node.type.startsWith('heading')) {
      const level = Number(node.attrs?.level ?? 1)
      const text = (node.content ?? [])
        .map((child) => (child.type === 'text' && typeof child.text === 'string' ? child.text : ''))
        .join('')
        .trim()
      if (text) items.push({ index: items.length, level, text })
    }
    node.content?.forEach(visit)
  }
  visit(doc)
  return items
}

/** 安全获取 ProseMirror 内容 DOM：Tiptap 在 view 未挂载时访问会抛错。 */
function getEditorViewDom(editor: Editor): HTMLElement | null {
  try {
    const view = editor.view
    if (!view) return null
    return view.dom instanceof HTMLElement ? view.dom : null
  } catch {
    return null
  }
}

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
  const labels = useMemo(() => ({ ...defaultLabels, ...labelOverrides }), [labelOverrides])
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
  const extensions = useMemo(() => createViewerExtensions(viewerContextRef), [viewerContextRef])
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
