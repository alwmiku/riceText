import '@testing-library/jest-dom/vitest'

import type { JSONContent } from '@tiptap/core'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { RichTextViewer, useRichTextViewerController } from './viewer.js'

beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () { /* empty */ } }),
  })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, 0, 0),
  })
})

const interactiveDocument: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [
        { type: 'text', text: 'source', marks: [{ type: 'link', attrs: { href: 'https://example.com/source' } }] },
        { type: 'text', text: ' secret', marks: [{ type: 'spoiler' }] },
        { type: 'hardBreak' },
        { type: 'inlineCommentAnchor', attrs: { threadId: 'thread-1', count: 3, placement: 'end' } },
        { type: 'mention', attrs: { userId: 'u1', name: 'Lin', resolved: true, avatarUrl: '/uploads/avatar.png' } },
        { type: 'diceRoll', attrs: { rollId: 'roll-1', expression: '3d5', rolls: [3, 4, 5], total: 12, rerollOf: null } },
      ],
    },
    {
      type: 'novelExcerpt',
      attrs: { bookTitle: 'Rice Book', chapterTitle: 'Chapter 1', author: 'Writer', sourceUrl: 'https://example.com/book', variant: 'mobile-book' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Excerpt body' }] }],
    },
    {
      type: 'replyGate', attrs: { gateId: 'gate-1', prompt: 'Reply to unlock' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hidden chapter' }] }],
    },
    { type: 'attachmentRef', attrs: { attachmentId: 'file-1', name: 'archive.zip', mimeType: 'application/zip', size: 2_048, priceCoins: 8 } },
    { type: 'attachmentRef', attrs: { attachmentId: 'file-2', name: 'book.txt', mimeType: 'text/plain', size: 512, priceCoins: 0 } },
    {
      type: 'pollRef', attrs: {
        pollId: 'poll-1', question: 'Choose one', multiple: false,
        options: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }],
      },
    },
    { type: 'richImage', attrs: { assetId: 'a1', src: '/uploads/alpha.png', alt: 'Alpha image', caption: 'Alpha caption', align: 'left', width: 60 } },
    { type: 'richImage', attrs: { assetId: 'a2', src: '/uploads/beta.png', alt: 'Beta image', caption: '', align: 'right', width: 80 } },
  ],
}

describe('RichTextViewer', () => {
  it('renders read-only ProseMirror content without editor surfaces', async () => {
    const { container } = render(<RichTextViewer content={{
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read only', marks: [{ type: 'bold' }] }] }],
    }} />)

    await screen.findByText('Read only')
    expect(container.querySelector('article')).not.toBeNull()
    expect(container.querySelector('strong')).toHaveTextContent('Read only')
    expect(container.querySelector('[contenteditable="true"]')).not.toBeInTheDocument()
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('renders empty comment anchors as small gray bubbles without a number', async () => {
    const { container } = render(<RichTextViewer enableLightbox={false} content={{
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'inlineCommentAnchor', attrs: { threadId: 'thread-0', count: 0, placement: 'end' } }],
      }],
    }} />)

    await waitFor(() => expect(container.querySelector('.rt-inline-comment-anchor--empty')).not.toBeNull())
    const bubble = container.querySelector('.rt-inline-comment-anchor--empty')
    expect(bubble).not.toHaveTextContent('0')
  })

  it('renders a synthetic empty bubble at the end of paragraphs without an anchor', async () => {
    const { container } = render(<RichTextViewer enableLightbox={false} content={{
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain paragraph' }] }],
    }} />)

    await screen.findByText('plain paragraph')
    await waitFor(() => expect(container.querySelector('.rt-inline-comment-anchor--empty')).not.toBeNull())
    expect(container.innerHTML).toContain('plain paragraph')
  })

  it('renders custom references and strips unsafe URLs before rendering', async () => {
    const { container } = render(<RichTextViewer enableLightbox={false} content={{
      type: 'doc',
      content: [
        { type: 'paragraph', content: [
          { type: 'mention', attrs: { userId: 'u1', name: 'Lin', resolved: true, avatarUrl: null } },
          { type: 'text', text: ' rolled ' },
          { type: 'diceRoll', attrs: { rollId: 'r1', expression: '3d5', rolls: [3, 4, 5], total: 12, rerollOf: null } },
        ] },
        { type: 'richImage', attrs: { assetId: null, src: 'javascript:alert(1)', alt: 'unsafe', caption: '', align: 'center', width: 100 } },
      ],
    }} />)

    await screen.findByText('@Lin')
    expect(screen.getByText('3d5')).toBeInTheDocument()
    expect(screen.getByText('= 12')).toBeInTheDocument()
    expect(container.innerHTML).not.toContain('javascript:')
    expect(container.querySelector('[contenteditable="true"]')).not.toBeInTheDocument()
  })

  it('keeps reply gates locked by default and does not add synthetic anchors inside them', async () => {
    const { container } = render(<RichTextViewer
      enableLightbox={false}
      content={{ type: 'doc', content: [{
        type: 'replyGate', attrs: { gateId: 'g1', prompt: 'Reply first' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'secret body' }] }],
      }] }}
    />)

    await screen.findByText('Reply first')
    expect(screen.queryByText('secret body')).not.toBeInTheDocument()
    expect(container.querySelector('.rt-inline-comment-anchor--empty')).toBeNull()
  })

  it('projects locked reply content without leaking its children', async () => {
    render(<RichTextViewer
      interactions={{ isReplyGateVisible: () => false }}
      content={{ type: 'doc', content: [{
        type: 'replyGate', attrs: { gateId: 'g1', prompt: 'Reply first' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'secret body' }] }],
      }] }}
    />)

    await screen.findByText('Reply first')
    expect(screen.queryByText('secret body')).not.toBeInTheDocument()
  })

  it('renders structural blocks and every supported ordinary mark', async () => {
    const { container } = render(<RichTextViewer content={{
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 6, textAlign: 'right' }, content: [{ type: 'text', text: 'Heading' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bullet' }] }] }] },
        { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Numbered' }] }] }] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quote' }] }] },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const x = 1' }] },
        { type: 'horizontalRule' },
        { type: 'paragraph', content: [{
          type: 'text', text: 'marked', marks: [
            { type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'strike' }, { type: 'code' },
            { type: 'textStyle', attrs: { color: '#0f766e', fontFamily: 'serif', fontSize: '18px' } },
          ],
        }] },
      ],
    }} />)

    await screen.findByText('Heading')
    const html = container.innerHTML
    expect(html).toContain('<h6')
    expect(html).toContain('<ul>')
    expect(html).toContain('<ol start="3">')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<pre>')
    expect(html).toContain('<hr')
    expect(html).toContain('serif')
  })

  it('dispatches inline comments, dice, mentions, reply gates, attachments, polls, links, and spoilers', async () => {
    const onInlineCommentActivate = vi.fn()
    const onDiceReroll = vi.fn()
    const onMentionActivate = vi.fn()
    const onReplyGateRequest = vi.fn()
    const onAttachmentActivate = vi.fn()
    const onPollVote = vi.fn()
    const onLinkActivate = vi.fn()
    render(<RichTextViewer
      content={interactiveDocument}
      enableLightbox={false}
      labels={{ inlineComments: 'Comments', rerollDice: 'Roll again', purchase: 'Buy', votes: 'ballots' }}
      interactions={{
        onInlineCommentActivate,
        onDiceReroll,
        onMentionActivate,
        renderMentionCard: () => <span>Profile card</span>,
        isReplyGateVisible: () => false,
        onReplyGateRequest,
        getAttachmentState: (attrs) => ({ available: attrs.attachmentId === 'file-2', pending: false }),
        onAttachmentActivate,
        getPollState: () => ({ selectedOptionIds: ['two'], votesByOption: { one: 4, two: 7 }, canVote: true, pending: false }),
        onPollVote,
        onLinkActivate,
      }}
    />)

    await screen.findByRole('button', { name: 'Comments: 3' })
    fireEvent.click(screen.getByRole('button', { name: 'Comments: 3' }))
    fireEvent.click(screen.getByTitle('Roll again'))
    const mention = document.querySelector('.rt-mention') as HTMLElement
    fireEvent.click(mention)
    fireEvent.keyDown(mention, { key: 'Enter' })
    fireEvent.keyDown(mention, { key: ' ' })
    fireEvent.click(screen.getByRole('button', { name: 'Reply to unlock' }))
    fireEvent.click(screen.getByText('archive.zip').closest('button') as HTMLButtonElement)
    fireEvent.click(screen.getByRole('button', { name: /One\s*4 ballots/u }))
    fireEvent.click(screen.getByRole('link', { name: 'source' }))

    const spoiler = document.querySelector('[data-spoiler="true"]') as HTMLElement
    expect(spoiler).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(spoiler)
    expect(spoiler).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(spoiler, { key: 'Enter' })
    fireEvent.keyDown(spoiler, { key: ' ' })

    expect(onInlineCommentActivate).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thread-1' }))
    expect(onDiceReroll).toHaveBeenCalledWith(expect.objectContaining({ rollId: 'roll-1', total: 12 }))
    expect(onMentionActivate).toHaveBeenCalledTimes(3)
    expect(screen.getByText('Profile card')).toBeInTheDocument()
    expect(onReplyGateRequest).toHaveBeenCalledWith(expect.objectContaining({ gateId: 'gate-1' }))
    expect(onAttachmentActivate).toHaveBeenCalledWith(expect.objectContaining({ attachmentId: 'file-1' }))
    expect(screen.getByText('2.0 KB · application/zip')).toBeInTheDocument()
    expect(screen.getByText('512 B · text/plain')).toBeInTheDocument()
    expect(onPollVote).toHaveBeenCalledWith(expect.objectContaining({ pollId: 'poll-1' }), 'one')
    expect(screen.getByRole('button', { name: /Two\s*7 ballots/u })).toHaveAttribute('aria-pressed', 'true')
    expect(onLinkActivate).toHaveBeenCalledWith('https://example.com/source', expect.anything())
  })

  it('shows visible gated content and disables unavailable business actions', async () => {
    render(<RichTextViewer
      content={interactiveDocument}
      enableLightbox={false}
      interactions={{
        isReplyGateVisible: () => true,
        getAttachmentState: () => ({ available: false, pending: true }),
        onAttachmentActivate: vi.fn(),
        getPollState: () => ({ selectedOptionIds: [], votesByOption: {}, canVote: false, pending: false }),
        onPollVote: vi.fn(),
      }}
    />)

    await screen.findByText('Hidden chapter')
    expect(screen.getByText('archive.zip').closest('button')).toBeDisabled()
    expect(screen.getByRole('button', { name: /One\s*0 votes/u })).toBeDisabled()
    expect(screen.getByText('Source')).toHaveAttribute('href', 'https://example.com/book')
  })

  it('opens the gallery and supports toolbar, keyboard, wheel, and drag controls', async () => {
    const onImageOpen = vi.fn()
    Object.defineProperty(window, 'PointerEvent', { configurable: true, value: MouseEvent })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() })
    render(<RichTextViewer content={interactiveDocument} interactions={{ onImageOpen }} labels={{ closeImage: 'Dismiss', nextImage: 'Forward', previousImage: 'Back' }} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Alpha image' }))
    expect(onImageOpen).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'a1', index: 0 }))
    expect(screen.getByRole('dialog', { name: 'Alpha image' })).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
    expect(screen.getByRole('dialog', { name: 'Beta image' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('dialog', { name: 'Alpha image' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('125%')
    const stage = document.querySelector('.rt-lightbox__stage') as HTMLDivElement
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 10, clientY: 20 })
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 30, clientY: 50 })
    fireEvent.pointerUp(stage, { pointerId: 1 })
    await waitFor(() => expect(screen.getByRole('dialog').querySelector('img')).toHaveStyle({ transform: 'translate(20px, 30px) scale(1.25)' }))

    fireEvent.wheel(stage, { deltaY: 10 })
    fireEvent.wheel(stage, { deltaY: -10 })
    fireEvent.keyDown(document, { key: '=' })
    fireEvent.keyDown(document, { key: '-' })
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(screen.getByRole('dialog', { name: 'Beta image' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('clamps and resets the reusable viewer controller', async () => {
    const { result, rerender } = renderHook(({ count }) => useRichTextViewerController(count), { initialProps: { count: 2 } })
    act(() => result.current.openImage(-10))
    expect(result.current.lightbox.index).toBe(0)
    act(() => result.current.previousImage())
    expect(result.current.lightbox.index).toBe(1)
    act(() => result.current.nextImage())
    expect(result.current.lightbox.index).toBe(0)

    act(() => {
      result.current.changeZoom(10)
      result.current.panBy(12, -4)
      result.current.toggleSpoiler('s1')
    })
    expect(result.current.lightbox).toMatchObject({ zoom: 4, offsetX: 12, offsetY: -4 })
    expect(result.current.revealedSpoilers.has('s1')).toBe(true)
    act(() => {
      result.current.changeZoom(-10)
      result.current.resetTransform()
      result.current.toggleSpoiler('s1')
    })
    expect(result.current.lightbox).toMatchObject({ zoom: 1, offsetX: 0, offsetY: 0 })
    expect(result.current.revealedSpoilers.has('s1')).toBe(false)

    act(() => result.current.openImage(99))
    rerender({ count: 1 })
    await waitFor(() => expect(result.current.lightbox.index).toBe(0))
    act(() => result.current.closeImage())
    expect(result.current.lightbox.index).toBeNull()
    rerender({ count: 0 })
    act(() => {
      result.current.openImage(0)
      result.current.previousImage()
      result.current.nextImage()
    })
    expect(result.current.lightbox.index).toBeNull()
  })
})
