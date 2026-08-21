import type { JSONContent } from '@tiptap/core'
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, WheelEvent } from 'react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { sanitizeDocument } from './sanitize.js'
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
  /** Casts or replaces a vote for one option. */
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
  pathToIndex: Map<string, number>
}

/** 单次遍历收集图片和 JSON 路径索引，保证正文顺序就是灯箱前后顺序。 */
function collectGallery(document: JSONContent): GalleryData {
  const images: ViewerImage[] = []
  const pathToIndex = new Map<string, number>()
  const visit = (node: JSONContent, path: string) => {
    if (node.type === 'richImage') {
      const attrs = node.attrs as unknown as RichImageAttributes
      const index = images.length
      images.push({ ...attrs, index })
      pathToIndex.set(path, index)
    }
    node.content?.forEach((child, index) => visit(child, `${path}.${index}`))
  }
  visit(document, '0')
  return { images, pathToIndex }
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

interface RenderContext {
  controller: RichTextViewerController
  interactions: RichTextViewerInteractions
  labels: RichTextViewerLabels
  gallery: GalleryData
  enableLightbox: boolean
}

/** 按白名单 mark 递归包裹文本；未知 mark 已在 sanitize 阶段移除。 */
function renderMarks(node: JSONContent, content: ReactNode, path: string, context: RenderContext): ReactNode {
  return node.marks?.reduce<ReactNode>((child, mark, index) => {
    const key = `${path}-mark-${index}`
    switch (mark.type) {
      case 'bold': return <strong key={key}>{child}</strong>
      case 'italic': return <em key={key}>{child}</em>
      case 'underline': return <u key={key}>{child}</u>
      case 'strike': return <s key={key}>{child}</s>
      case 'code': return <code key={key}>{child}</code>
      case 'link': {
        const href = String(mark.attrs?.href ?? '')
        return <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow" onClick={(event) => context.interactions.onLinkActivate?.(href, event)}>{child}</a>
      }
      case 'textStyle': {
        const style: CSSProperties = {
          color: typeof mark.attrs?.color === 'string' ? mark.attrs.color : undefined,
          fontFamily: typeof mark.attrs?.fontFamily === 'string' ? mark.attrs.fontFamily : undefined,
          fontSize: typeof mark.attrs?.fontSize === 'string' ? mark.attrs.fontSize : undefined,
        }
        return <span key={key} style={style}>{child}</span>
      }
      case 'spoiler': {
        const spoilerKey = `${path}:${index}`
        const revealed = context.controller.revealedSpoilers.has(spoilerKey)
        return (
          <span key={key} className={`rt-spoiler${revealed ? ' rt-spoiler--revealed' : ''}`} data-spoiler="true" role="button" tabIndex={0} aria-expanded={revealed}
            onClick={() => context.controller.toggleSpoiler(spoilerKey)} onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); context.controller.toggleSpoiler(spoilerKey) }
            }}>
            {child}
          </span>
        )
      }
      default: return child
    }
  }, content) ?? content
}

function renderChildren(node: JSONContent, path: string, context: RenderContext): ReactNode {
  return node.content?.map((child, index) => renderNode(child, `${path}.${index}`, context)) ?? null
}

/**
 * 把规范 JSON 映射为普通 React 元素。
 * 业务节点只通过 interactions 调用宿主，不在 Viewer 内直接请求接口或持有领域数据。
 */
function renderNode(node: JSONContent, path: string, context: RenderContext): ReactNode {
  const children = renderChildren(node, path, context)
  const attrs = node.attrs ?? {}
  switch (node.type) {
    case 'doc': return <Fragment key={path}>{children}</Fragment>
    case 'text': return <Fragment key={path}>{renderMarks(node, node.text ?? '', path, context)}</Fragment>
    case 'paragraph': {
      const hasEndAnchor = node.content?.some((child) => child.type === 'inlineCommentAnchor' && child.attrs?.placement === 'end') ?? false
      const hasVisibleContent = node.content?.some((child) => child.type !== 'inlineCommentAnchor') ?? false
      return (
        <p key={path} style={{ textAlign: attrs.textAlign as CSSProperties['textAlign'] }}>
          {children}
          {!hasEndAnchor && hasVisibleContent ? (
            <button key={`${path}-comment`} type="button" className="rt-inline-comment-anchor rt-inline-comment-anchor--empty" data-node-type="inline-comment-anchor" data-thread-id={`auto:${path}`} data-count="0" data-placement="end" aria-label={`${context.labels.inlineComments}: 0`}
              onClick={() => context.interactions.onInlineCommentActivate?.({ threadId: `auto:${path}`, count: 0, placement: 'end' })} />
          ) : null}
        </p>
      )
    }
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(attrs.level ?? 2)))
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      return <Tag key={path} style={{ textAlign: attrs.textAlign as CSSProperties['textAlign'] }}>{children}</Tag>
    }
    case 'bulletList': return <ul key={path}>{children}</ul>
    case 'orderedList': return <ol key={path} start={Number(attrs.start ?? 1)}>{children}</ol>
    case 'listItem': return <li key={path}>{children}</li>
    case 'blockquote': return <blockquote key={path}>{children}</blockquote>
    case 'codeBlock': return <pre key={path}><code>{children}</code></pre>
    case 'hardBreak': return <br key={path} />
    case 'horizontalRule': return <hr key={path} />
    case 'inlineCommentAnchor': {
      const value = attrs as unknown as InlineCommentAnchorAttributes
      const empty = value.count <= 0
      return (
        <button key={path} type="button" className={`rt-inline-comment-anchor rt-inline-comment-anchor--${value.placement}${empty ? ' rt-inline-comment-anchor--empty' : ''}`} data-node-type="inline-comment-anchor" data-thread-id={value.threadId} data-count={value.count} data-placement={value.placement} aria-label={`${context.labels.inlineComments}: ${value.count}`}
          onClick={() => context.interactions.onInlineCommentActivate?.(value)}>{empty ? '' : value.count}</button>
      )
    }
    case 'richImage': {
      const value = attrs as unknown as RichImageAttributes
      const index = context.gallery.pathToIndex.get(path) ?? 0
      const image = context.gallery.images[index]
      const open = () => {
        if (!context.enableLightbox || !image) return
        context.controller.openImage(index)
        context.interactions.onImageOpen?.(image)
      }
      return (
        <figure key={path} className={`rt-rich-image rt-rich-image--${value.align}`} style={{ width: `${value.width}%` }}>
          <button type="button" className="rt-rich-image__open" disabled={!context.enableLightbox} onClick={open} aria-label={value.alt || 'Open image'}>
            <img src={value.src} alt={value.alt} loading="lazy" />
          </button>
          {value.caption ? <figcaption>{value.caption}</figcaption> : null}
        </figure>
      )
    }
    case 'diceRoll': {
      const value = attrs as unknown as DiceRollAttributes
      const dice = <span className="rt-dice-roll" title={value.rolls.join(' + ')}><span>{value.expression}</span><strong>= {value.total}</strong></span>
      return <Fragment key={path}>{renderMarks(node, context.interactions.onDiceReroll ? <button type="button" className="rt-dice-roll__button" title={context.labels.rerollDice} onClick={() => context.interactions.onDiceReroll?.(value)}>{dice}</button> : dice, path, context)}</Fragment>
    }
    case 'novelExcerpt': {
      const value = attrs as unknown as NovelExcerptAttributes
      return (
        <aside key={path} className={`rt-novel-excerpt rt-novel-excerpt--${value.variant}`}>
          <header><strong>{value.bookTitle}</strong><span>{value.chapterTitle}</span><small>{value.author}</small></header>
          <div className="rt-novel-excerpt__content">{children}</div>
          {value.sourceUrl ? <a href={value.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">{context.labels.source}</a> : null}
        </aside>
      )
    }
    case 'mention': {
      const value = attrs as unknown as MentionAttributes
      return <Fragment key={path}>{renderMarks(node, (
        <span className={`rt-mention ${value.resolved ? 'rt-mention--resolved' : 'rt-mention--unresolved'}`} role={context.interactions.onMentionActivate ? 'button' : undefined}
          tabIndex={context.interactions.onMentionActivate ? 0 : undefined} onClick={() => context.interactions.onMentionActivate?.(value)} onKeyDown={(event) => {
            if ((event.key === 'Enter' || event.key === ' ') && context.interactions.onMentionActivate) context.interactions.onMentionActivate(value)
          }}>
          @{value.name}{context.interactions.renderMentionCard ? <span className="rt-mention__card">{context.interactions.renderMentionCard(value)}</span> : null}
        </span>
      ), path, context)}</Fragment>
    }
    case 'replyGate': {
      const value = attrs as unknown as ReplyGateAttributes
      const visible = context.interactions.isReplyGateVisible?.(value) ?? true
      return visible ? <section key={path} className="rt-reply-gate rt-reply-gate--visible">{children}</section> : (
        <section key={path} className="rt-reply-gate rt-reply-gate--locked">
          <button type="button" onClick={() => context.interactions.onReplyGateRequest?.(value)}>{value.prompt}</button>
        </section>
      )
    }
    case 'attachmentRef': {
      const value = attrs as unknown as AttachmentReferenceAttributes
      const state = context.interactions.getAttachmentState?.(value) ?? { available: value.priceCoins === 0, pending: false }
      return (
        <button key={path} type="button" className="rt-attachment" disabled={state.pending || !context.interactions.onAttachmentActivate} onClick={() => context.interactions.onAttachmentActivate?.(value)}>
          <span className="rt-attachment__name">{value.name}</span><small>{formatBytes(value.size)} · {value.mimeType}</small>
          <strong>{state.available ? context.labels.download : `${context.labels.purchase} · ${value.priceCoins} ${context.labels.coins}`}</strong>
        </button>
      )
    }
    case 'pollRef': {
      const value = attrs as unknown as PollReferenceAttributes
      const state = context.interactions.getPollState?.(value) ?? { selectedOptionIds: [], votesByOption: {}, canVote: true, pending: false }
      return (
        <section key={path} className="rt-poll" aria-labelledby={`poll-${value.pollId}`}>
          <h3 id={`poll-${value.pollId}`}>{value.question}</h3>
          <div className="rt-poll__options">{value.options.map((option) => {
            const selected = state.selectedOptionIds.includes(option.id)
            return <button key={option.id} type="button" aria-pressed={selected} disabled={!state.canVote || state.pending || !context.interactions.onPollVote} onClick={() => context.interactions.onPollVote?.(value, option.id)}><span>{option.label}</span><small>{state.votesByOption[option.id] ?? 0} {context.labels.votes}</small></button>
          })}</div>
        </section>
      )
    }
    default: return null
  }
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
  // 键盘监听只在灯箱打开时存在，关闭或切图时会清理旧监听器。
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

/**
 * Renders sanitized Tiptap JSON as ordinary React elements. It deliberately
 * does not import `@tiptap/react`, create an `Editor`, or emit `contenteditable`.
 */
export function RichTextViewer({ content, className = '', interactions = {}, controller: externalController, enableLightbox = true, labels: labelOverrides = {} }: RichTextViewerProps) {
  const document = useMemo(() => sanitizeDocument(content), [content])
  const gallery = useMemo(() => collectGallery(document), [document])
  const internalController = useRichTextViewerController(gallery.images.length)
  const controller = externalController ?? internalController
  const labels = useMemo(() => ({ ...defaultLabels, ...labelOverrides }), [labelOverrides])
  const context: RenderContext = { controller, interactions, labels, gallery, enableLightbox }
  return (
    <>
      <article className={`rt-viewer ${className}`}>{renderNode(document, '0', context)}</article>
      {enableLightbox ? <ImageLightbox controller={controller} images={gallery.images} labels={labels} /> : null}
    </>
  )
}
