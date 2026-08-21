import { describe, expect, it } from 'vitest'

import {
  MAX_DOCUMENT_DEPTH,
  MAX_DOCUMENT_NODES,
  parseDocumentJson,
  sanitizeColor,
  sanitizeDocument,
  sanitizeFontFamily,
  sanitizeFontSize,
  sanitizeUrl,
  stringifyDocument,
  validateDocument,
} from './sanitize.js'

describe('document sanitization', () => {
  it('removes unknown structures, attributes, and unsafe links', () => {
    const result = validateDocument({
      type: 'doc',
      attrs: { onclick: 'attack()' },
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'center', style: 'position:fixed' },
          content: [{ type: 'text', text: 'safe', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }],
        },
        { type: 'script', content: [{ type: 'text', text: 'bad' }] },
      ],
    })

    expect(result.valid).toBe(false)
    expect(result.issues.map((item) => item.code)).toEqual(expect.arrayContaining(['unknown-attribute', 'unsafe-url', 'unknown-node']))
    expect(JSON.stringify(result.document)).not.toContain('javascript:')
    expect(JSON.stringify(result.document)).not.toContain('position:fixed')
    expect(JSON.stringify(result.document)).not.toContain('script')
  })

  it('keeps persisted custom nodes while normalizing their values', () => {
    const safe = sanitizeDocument({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'diceRoll', attrs: { rollId: 'roll-1', expression: '3d5', rolls: [3, 4, 5], total: 12, rerollOf: null } },
          { type: 'inlineCommentAnchor', attrs: { threadId: 'thread-1', count: 4, placement: 'start' } },
        ],
      }, {
        type: 'richImage',
        attrs: { assetId: 'asset-1', src: '/uploads/a.png', alt: 'A', caption: '', align: 'right', width: 150 },
      }],
    })

    expect(safe.content?.[0]?.content?.[0]?.attrs).toMatchObject({ rollId: 'roll-1', total: 12, rolls: [3, 4, 5] })
    expect(safe.content?.[0]?.content?.[1]?.attrs).toMatchObject({ threadId: 'thread-1', placement: 'start' })
    expect(safe.content?.[1]?.attrs).toMatchObject({ src: '/uploads/a.png', align: 'right', width: 100 })
  })

  it('rejects embedded image data and unsafe CSS while preserving allowed text style', () => {
    const safe = sanitizeDocument({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'styled',
          marks: [{ type: 'textStyle', attrs: { color: '#0f766e', fontFamily: 'Noto Serif SC', fontSize: '18px', background: 'url(javascript:x)' } }],
        }],
      }, { type: 'richImage', attrs: { src: 'data:image/png;base64,AAAA', width: 100 } }],
    })

    expect(safe.content?.[0]?.content?.[0]?.marks?.[0]?.attrs).toEqual({ color: '#0f766e', fontFamily: 'Noto Serif SC', fontSize: '18px' })
    expect(safe.content?.[1]?.attrs?.src).toBe('')
    expect(stringifyDocument(safe)).not.toContain('base64')
  })

  it('uses protocol allowlists and handles malformed serialized JSON', () => {
    expect(sanitizeUrl('https://example.com/a', 'image')).toBe('https://example.com/a')
    expect(sanitizeUrl('/uploads/a.jpg', 'image')).toBe('/uploads/a.jpg')
    expect(sanitizeUrl('/api/assets/a1b2', 'image')).toBe('/api/assets/a1b2')
    expect(sanitizeUrl('blob:local-object-url', 'image')).toBe('blob:local-object-url')
    expect(sanitizeUrl('mailto:user@example.com', 'link')).toBe('mailto:user@example.com')
    expect(sanitizeUrl('mailto:user@example.com', 'image')).toBeNull()
    expect(sanitizeUrl('vbscript:msgbox(1)', 'link')).toBeNull()
    expect(parseDocumentJson('{oops').valid).toBe(false)
  })

  it('repairs structurally invalid but otherwise allowed nodes', () => {
    const result = validateDocument({
      type: 'doc',
      content: [{ type: 'text', text: 'top-level text' }, { type: 'bulletList', content: [{ type: 'paragraph' }] }],
    })
    expect(result.valid).toBe(false)
    expect(result.issues.some((item) => item.code === 'invalid-structure')).toBe(true)
    expect(result.document.content?.[0]?.type).toBe('bulletList')
    expect(result.document.content?.[0]?.content?.[0]?.type).toBe('listItem')
  })

  it('handles every URL allowlist edge without accepting controls or disguised paths', () => {
    expect(sanitizeUrl(undefined)).toBeNull()
    expect(sanitizeUrl('   ')).toBeNull()
    expect(sanitizeUrl(`https://example.com/${'a'.repeat(2_100)}`)).toBeNull()
    expect(sanitizeUrl('https://example.com/a\n')).toBeNull()
    expect(sanitizeUrl('/uploads/good.png', 'image')).toBe('/uploads/good.png')
    expect(sanitizeUrl('/uploads\\bad.png', 'image')).toBeNull()
    expect(sanitizeUrl('/profile/1', 'link')).toBe('/profile/1')
    expect(sanitizeUrl('#chapter', 'link')).toBe('#chapter')
    expect(sanitizeUrl('/profile/1', 'image')).toBeNull()
    expect(sanitizeUrl('ftp://example.com/file', 'link')).toBeNull()
    expect(sanitizeUrl('not a url', 'link')).toBeNull()
    expect(sanitizeUrl('HTTPS://EXAMPLE.COM/a', 'image')).toBe('https://example.com/a')
  })

  it('normalizes safe colors, fonts, and pixel sizes', () => {
    expect(sanitizeColor('#ABC')).toBe('#abc')
    expect(sanitizeColor('#00FF7F')).toBe('#00ff7f')
    expect(sanitizeColor('rgb(1, 20, 255)')).toBe('rgb(1, 20, 255)')
    expect(sanitizeColor('rgb(0, 0, 999)')).toBeNull()
    expect(sanitizeColor('red')).toBeNull()
    expect(sanitizeColor(123)).toBeNull()
    expect(sanitizeFontFamily('Microsoft YaHei')).toBe('Microsoft YaHei')
    expect(sanitizeFontFamily('Comic Sans MS')).toBeNull()
    expect(sanitizeFontFamily(null)).toBeNull()
    expect(sanitizeFontSize(24)).toBe('24px')
    expect(sanitizeFontSize('18px')).toBe('18px')
    expect(sanitizeFontSize('17px')).toBeNull()
    expect(sanitizeFontSize({})).toBeNull()
  })

  it('reports malformed and unknown marks while retaining only normalized mark data', () => {
    const result = validateDocument({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text', text: 'marks', attrs: { bad: true }, marks: [
            null,
            { nope: true },
            { type: 'bold', attrs: { onclick: 'x' } },
            { type: 'unknown' },
            { type: 'link', attrs: { href: '/safe', target: '_self', extra: true } },
            { type: 'link', attrs: { href: 'data:text/html,bad' } },
            { type: 'textStyle', attrs: { color: 'red', fontFamily: 'Papyrus', fontSize: '17px' } },
            { type: 'textStyle', attrs: {} },
          ],
        }],
      }],
    })

    const marks = result.document.content?.[0]?.content?.[0]?.marks
    expect(marks).toEqual([
      { type: 'bold' },
      { type: 'link', attrs: { href: '/safe', target: '_blank', rel: 'noopener noreferrer nofollow' } },
    ])
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['unknown-mark', 'unknown-attribute', 'unsafe-url', 'invalid-attribute']))
  })

  it('strips bold, italic, and text color from spoiler text while keeping font settings', () => {
    const safe = sanitizeDocument({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'secret',
          marks: [
            { type: 'spoiler' },
            { type: 'bold' },
            { type: 'italic' },
            { type: 'textStyle', attrs: { color: '#ff0000', fontFamily: 'serif', fontSize: '18px' } },
          ],
        }],
      }],
    })

    const marks = safe.content?.[0]?.content?.[0]?.marks
    expect(marks).toContainEqual({ type: 'spoiler' })
    expect(marks).not.toContainEqual({ type: 'bold' })
    expect(marks).not.toContainEqual({ type: 'italic' })
    expect(marks).toContainEqual({ type: 'textStyle', attrs: { fontFamily: 'serif', fontSize: '18px' } })
  })

  it('normalizes attributes for every persisted business node', () => {
    const result = validateDocument({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 99, textAlign: 'justify' }, content: [{ type: 'text', text: 'H' }] },
        { type: 'orderedList', attrs: { start: -5 }, content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
        { type: 'codeBlock', attrs: { language: 42 }, content: [{ type: 'text', text: 'code', marks: [{ type: 'bold' }] }] },
        { type: 'paragraph', content: [
          { type: 'inlineCommentAnchor', attrs: { threadId: 4, count: 2_000_000, placement: 'other' } },
          { type: 'diceRoll', attrs: { rollId: 3, expression: null, rolls: [Infinity, -2_000_000, 4.4], total: Infinity, rerollOf: '' }, marks: [{ type: 'italic' }] },
          { type: 'mention', attrs: { userId: '', name: 4, resolved: 'true', avatarUrl: 'file:///x' }, marks: [{ type: 'bold' }] },
        ] },
        { type: 'richImage', attrs: { assetId: '', src: 'data:image/png;base64,x', alt: 4, caption: null, align: 'other', width: 4 } },
        {
          type: 'novelExcerpt', attrs: { bookTitle: 4, chapterTitle: 'C', author: 'A', sourceUrl: 'javascript:x', variant: 'other' },
          content: [{ type: 'paragraph' }],
        },
        { type: 'replyGate', attrs: { gateId: 4, prompt: null }, content: [] },
        { type: 'attachmentRef', attrs: { attachmentId: 4, name: null, mimeType: null, size: -1, priceCoins: 2_000_000_000 } },
        { type: 'pollRef', attrs: { pollId: 4, question: null, multiple: 'true', options: [null, { id: '', label: 'No' }, { id: 'yes', label: 'Yes' }] } },
      ],
    })

    expect(result.document.content?.[0]?.attrs).toEqual({ level: 6, textAlign: 'justify' })
    expect(result.document.content?.[1]?.attrs).toEqual({ start: 1 })
    expect(result.document.content?.[2]?.attrs).toEqual({ language: null })
    expect(result.document.content?.[2]?.content?.[0]?.marks).toBeUndefined()
    expect(result.document.content?.[3]?.content?.[0]?.attrs).toMatchObject({ threadId: '', count: 1_000_000, placement: 'end' })
    expect(result.document.content?.[3]?.content?.[1]?.attrs).toMatchObject({ rolls: [0, -1_000_000, 4], total: 0, rerollOf: null })
    expect(result.document.content?.[3]?.content?.[2]?.attrs).toMatchObject({ userId: null, resolved: false, avatarUrl: null })
    expect(result.document.content?.[4]?.attrs).toMatchObject({ assetId: null, src: '', align: 'center', width: 10 })
    expect(result.document.content?.[5]?.attrs).toMatchObject({ sourceUrl: null, variant: 'desktop-book' })
    expect(result.document.content?.[6]?.content?.[0]?.type).toBe('paragraph')
    expect(result.document.content?.[7]?.attrs).toMatchObject({ size: 0, priceCoins: 1_000_000_000 })
    expect(result.document.content?.[8]?.attrs).toMatchObject({ multiple: false, options: [{ id: 'yes', label: 'Yes' }] })
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['unsafe-url', 'invalid-structure']))
  })

  it('removes malformed text and child content from atomic nodes', () => {
    const result = validateDocument({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text' }, { type: 'hardBreak', content: [{ type: 'text', text: 'bad' }] }] },
        { type: 'blockquote', content: [] },
        { type: 'bulletList', content: [] },
      ],
    })

    expect(result.document.content?.[0]?.content?.[0]?.type).toBe('hardBreak')
    expect(result.document.content?.[0]?.content?.[0]?.content).toBeUndefined()
    expect(result.document.content?.[1]?.content?.[0]?.type).toBe('paragraph')
    expect(result.document.content?.[2]?.content?.[0]?.type).toBe('listItem')
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['invalid-attribute', 'invalid-structure']))
  })

  it('enforces nesting and node-count limits', () => {
    let nested: Record<string, unknown> = { type: 'paragraph', content: [{ type: 'text', text: 'bottom' }] }
    for (let index = 0; index < MAX_DOCUMENT_DEPTH + 2; index += 1) {
      nested = { type: 'replyGate', attrs: { gateId: `g${index}` }, content: [nested] }
    }
    const depthResult = validateDocument({ type: 'doc', content: [nested] })
    expect(depthResult.issues).toContainEqual(expect.objectContaining({ code: 'limit-exceeded' }))

    const manyNodes = Array.from({ length: MAX_DOCUMENT_NODES + 2 }, (_, index) => ({ type: 'text', text: String(index) }))
    const countResult = validateDocument({ type: 'doc', content: [{ type: 'paragraph', content: manyNodes }] })
    expect(countResult.issues).toContainEqual(expect.objectContaining({ code: 'limit-exceeded' }))
    expect(countResult.document.content?.[0]?.content?.length).toBeLessThan(manyNodes.length)
  })

  it('returns a safe default for non-document roots and parses valid JSON', () => {
    for (const value of [null, [], {}, { type: 'paragraph' }]) {
      const result = validateDocument(value)
      expect(result.valid).toBe(false)
      expect(result.issues[0]?.code).toBe('invalid-document')
      expect(result.document.content?.[0]?.type).toBe('paragraph')
    }

    const parsed = parseDocumentJson('{"type":"doc","content":[{"type":"paragraph"}]}')
    expect(parsed.valid).toBe(true)
    expect(JSON.parse(stringifyDocument(parsed.document))).toEqual(parsed.document)
  })
})
