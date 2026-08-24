import { Editor, type JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import { editorExtensions } from './extensions.js'

describe('editorExtensions', () => {
  it('registers the canonical custom schema exactly once', () => {
    const names = editorExtensions().map((extension) => extension.name)
    for (const name of ['inlineCommentAnchor', 'richImage', 'diceRoll', 'novelExcerpt', 'mention', 'replyGate', 'attachmentRef', 'pollRef', 'spoiler']) {
      expect(names.filter((candidate) => candidate === name)).toHaveLength(1)
    }
  })

  it('appends application extensions after the canonical schema', () => {
    const extension = { name: 'applicationExtension' } as ReturnType<typeof editorExtensions>[number]
    const names = editorExtensions({ additionalExtensions: [extension] }).map((item) => item.name)
    expect(names.at(-1)).toBe('applicationExtension')
  })

  it('executes every custom insertion command against the shared schema', () => {
    const assertInsertion = (type: string, insert: (editor: Editor) => boolean) => {
      const editor = new Editor({ extensions: editorExtensions(), content: { type: 'doc', content: [{ type: 'paragraph' }] } })
      expect(insert(editor)).toBe(true)
      const types: string[] = []
      const visit = (node: JSONContent) => { if (node.type) types.push(node.type); node.content?.forEach(visit) }
      visit(editor.getJSON())
      expect(types).toContain(type)
      expect(typeof editor.commands.toggleSpoiler).toBe('function')
      editor.destroy()
    }

    assertInsertion('inlineCommentAnchor', (editor) => editor.commands.insertInlineCommentAnchor({ threadId: 't1', count: 2, placement: 'end' }))
    assertInsertion('diceRoll', (editor) => editor.commands.insertDiceRoll({ rollId: 'r1', expression: '3d5', rolls: [3, 4, 5], total: 12, rerollOf: null }))
    assertInsertion('mention', (editor) => editor.commands.insertMention({ userId: 'u1', name: 'Lin', resolved: true, avatarUrl: null }))
    assertInsertion('richImage', (editor) => editor.commands.insertRichImage({ assetId: 'a1', src: '/uploads/a.png', alt: 'A', caption: '', align: 'center', width: 100 }))
    assertInsertion('novelExcerpt', (editor) => editor.commands.insertNovelExcerpt({ bookTitle: 'Book', chapterTitle: 'Chapter', author: 'Author', sourceUrl: null, variant: 'desktop-book' }))
    assertInsertion('replyGate', (editor) => editor.commands.insertReplyGate({ gateId: 'g1', prompt: 'Reply first' }))
    assertInsertion('attachmentRef', (editor) => editor.commands.insertAttachmentRef({ attachmentId: 'f1', name: 'file.txt', mimeType: 'text/plain', size: 4, priceCoins: 0 }))
    assertInsertion('pollRef', (editor) => editor.commands.insertPollRef({ pollId: 'p1', question: 'Choose', multiple: false, options: [{ id: 'o1', label: 'One' }] }))
  })

  it('does not reroll immutable dice JSON when an editor is remounted', () => {
    const content: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'diceRoll', attrs: { rollId: 'r1', expression: '3d5', rolls: [3, 4, 5], total: 12, rerollOf: null } }] }] }
    const first = new Editor({ extensions: editorExtensions(), content })
    const persisted = first.getJSON()
    first.destroy()
    const second = new Editor({ extensions: editorExtensions(), content: persisted })
    expect(second.getJSON()).toEqual(persisted)
    second.destroy()
  })

  it('parses and renders every custom node from persisted HTML', () => {
    const editor = new Editor({
      extensions: editorExtensions(),
      content: `
        <p>
          <span data-node-type="inline-comment-anchor" data-thread-id="thread-1" data-count="7" data-placement="start"></span>
          <span data-node-type="dice-roll" data-roll-id="roll-1" data-expression="3d5" data-rolls="[3,4,5]" data-total="12" data-reroll-of="old-roll"></span>
          <span data-node-type="mention" data-user-id="u1" data-name="Lin" data-resolved="true" data-avatar-url="/uploads/avatar.png"></span>
        </p>
        <figure data-node-type="rich-image" data-asset-id="a1" data-align="right" data-width="65"><img src="/uploads/a.png" alt="Alt"><figcaption>Caption</figcaption></figure>
        <aside data-node-type="novel-excerpt" data-book-title="Book" data-chapter-title="Chapter" data-author="Author" data-source-url="https://example.com/book" data-variant="mobile-book"><p>Excerpt</p></aside>
        <section data-node-type="reply-gate" data-gate-id="g1" data-prompt="Reply first"><p>Secret</p></section>
        <div data-node-type="attachment-ref" data-attachment-id="f1" data-name="file.txt" data-mime-type="text/plain" data-size="2048" data-price-coins="8"></div>
        <section data-node-type="poll-ref" data-poll-id="p1" data-question="Choose" data-multiple="true" data-options='[{"id":"o1","label":"One"}]'></section>
        <p><span data-spoiler="true">spoiler</span></p>
      `,
    })

    const nodes = new Map<string, JSONContent>()
    const visit = (node: JSONContent) => {
      if (node.type) nodes.set(node.type, node)
      node.content?.forEach(visit)
    }
    visit(editor.getJSON())

    expect(nodes.get('inlineCommentAnchor')?.attrs).toMatchObject({ threadId: 'thread-1', count: 7, placement: 'start' })
    expect(nodes.get('diceRoll')?.attrs).toMatchObject({ rollId: 'roll-1', rolls: [3, 4, 5], total: 12, rerollOf: 'old-roll' })
    expect(nodes.get('mention')?.attrs).toMatchObject({ userId: 'u1', resolved: true, avatarUrl: '/uploads/avatar.png' })
    expect(nodes.get('richImage')?.attrs).toMatchObject({ assetId: 'a1', src: '/uploads/a.png', caption: 'Caption', align: 'right', width: 65 })
    expect(nodes.get('novelExcerpt')?.attrs).toMatchObject({ sourceUrl: 'https://example.com/book', variant: 'mobile-book' })
    expect(nodes.get('replyGate')?.attrs).toMatchObject({ gateId: 'g1', prompt: 'Reply first' })
    expect(nodes.get('attachmentRef')?.attrs).toMatchObject({ size: 2048, priceCoins: 8 })
    expect(nodes.get('pollRef')?.attrs).toMatchObject({ multiple: true, options: [{ id: 'o1', label: 'One' }] })
    expect(nodes.get('text')?.marks).toEqual(expect.arrayContaining([{ type: 'spoiler' }]))

    const html = editor.getHTML()
    expect(html).toContain('data-node-type="inline-comment-anchor"')
    expect(html).toContain('data-node-type="rich-image"')
    expect(html).toContain('rt-rich-image--right')
    expect(html).toContain('data-node-type="dice-roll"')
    expect(html).toContain('3d5 = 12')
    expect(html).toContain('rt-mention--resolved')
    expect(html).toContain('data-node-type="novel-excerpt"')
    expect(html).toContain('data-node-type="reply-gate"')
    expect(html).toContain('data-node-type="attachment-ref"')
    expect(html).toContain('data-node-type="poll-ref"')
    expect(html).toContain('data-spoiler="true"')
    editor.destroy()
  })

  it('falls back safely while parsing malformed extension attributes', () => {
    const editor = new Editor({
      extensions: editorExtensions(),
      content: `
        <p>
          <span data-node-type="inline-comment-anchor" data-count="bad" data-placement="else"></span>
          <span data-node-type="dice-roll" data-rolls="not-json" data-total="999999999" data-expression="x"></span>
          <span data-node-type="mention" data-name="Ghost" data-avatar-url="javascript:bad"></span>
        </p>
        <figure data-node-type="rich-image" data-align="else" data-width="4"><img src="javascript:bad"></figure>
        <aside data-node-type="novel-excerpt" data-source-url="javascript:bad" data-variant="else"><p>Text</p></aside>
        <section data-node-type="reply-gate"><p>Text</p></section>
        <div data-node-type="attachment-ref" data-size="-4" data-price-coins="bad"></div>
        <section data-node-type="poll-ref" data-options="{}"></section>
      `,
    })

    const all: JSONContent[] = []
    const visit = (node: JSONContent) => { all.push(node); node.content?.forEach(visit) }
    visit(editor.getJSON())
    const find = (type: string) => all.find((node) => node.type === type)
    expect(find('inlineCommentAnchor')?.attrs).toMatchObject({ count: 0, placement: 'end' })
    expect(find('diceRoll')?.attrs).toMatchObject({ rolls: [], total: 100_000_000, rerollOf: null })
    expect(find('mention')?.attrs).toMatchObject({ resolved: false, avatarUrl: null })
    expect(find('richImage')?.attrs).toMatchObject({ src: '', align: 'center', width: 10 })
    expect(find('novelExcerpt')?.attrs).toMatchObject({ sourceUrl: null, variant: 'desktop-book' })
    expect(find('replyGate')?.attrs).toMatchObject({ prompt: 'Reply to view this content' })
    expect(find('attachmentRef')?.attrs).toMatchObject({ size: 0, priceCoins: 0 })
    expect(find('pollRef')?.attrs).toMatchObject({ multiple: false, options: [] })

    const rendered = editor.getHTML()
    expect(rendered).not.toContain('javascript:')
    expect(rendered).toContain('rt-rich-image--center')
    editor.destroy()

    const invalidArray = new Editor({
      extensions: editorExtensions(),
      content: '<p><span data-node-type="dice-roll" data-rolls="null"></span></p><section data-node-type="poll-ref" data-options="[broken"></section>',
    })
    const json = JSON.stringify(invalidArray.getJSON())
    expect(json).toContain('"rolls":[]')
    expect(json).toContain('"options":[]')
    invalidArray.destroy()
  })

  it('prevents bold, italic, and text style from coexisting with spoiler', () => {
    const editor = new Editor({ extensions: editorExtensions(), content: '<p>secret</p>' })
    editor.commands.selectAll()
    editor.commands.toggleBold()
    editor.commands.toggleSpoiler()
    let marks = editor.getJSON().content?.[0]?.content?.[0]?.marks
    expect(marks).toContainEqual({ type: 'spoiler' })
    expect(marks).not.toContainEqual({ type: 'bold' })

    editor.commands.selectAll()
    // Spoiler 的 excludes 是双向互斥：已带 spoiler 的文本无法再应用斜体，
    // 因此先移除上一轮的 spoiler，再验证「先斜体、后 spoiler」会被清理。
    editor.commands.toggleSpoiler()
    editor.commands.toggleItalic()
    editor.commands.toggleSpoiler()
    marks = editor.getJSON().content?.[0]?.content?.[0]?.marks
    expect(marks).toContainEqual({ type: 'spoiler' })
    expect(marks).not.toContainEqual({ type: 'italic' })

    editor.commands.selectAll()
    editor.commands.toggleSpoiler()
    editor.commands.setColor('#ff0000')
    editor.commands.toggleSpoiler()
    marks = editor.getJSON().content?.[0]?.content?.[0]?.marks
    expect(marks).toContainEqual({ type: 'spoiler' })
    expect(marks).not.toContainEqual(expect.objectContaining({ type: 'textStyle' }))
    editor.destroy()
  })

  it('protects inline comment anchors from deletion', () => {
    const content: JSONContent = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'keep' },
          { type: 'inlineCommentAnchor', attrs: { threadId: 't1', count: 2, placement: 'end' } },
        ],
      }],
    }
    const editor = new Editor({ extensions: editorExtensions(), content })
    const before = JSON.stringify(editor.getJSON())
    editor.commands.selectAll()
    editor.commands.deleteSelection()
    expect(JSON.stringify(editor.getJSON())).toBe(before)
    editor.destroy()
  })

  it('applies, toggles, and removes the spoiler command and rejects unsafe links', () => {
    const editor = new Editor({ extensions: editorExtensions(), content: '<p>classified</p>' })
    editor.commands.selectAll()
    expect(editor.commands.setSpoiler()).toBe(true)
    expect(editor.getJSON().content?.[0]?.content?.[0]?.marks).toContainEqual({ type: 'spoiler' })
    expect(editor.commands.toggleSpoiler()).toBe(true)
    expect(editor.getJSON().content?.[0]?.content?.[0]?.marks).toBeUndefined()
    expect(editor.commands.setSpoiler()).toBe(true)
    expect(editor.commands.unsetSpoiler()).toBe(true)
    expect(editor.commands.setLink({ href: 'javascript:alert(1)' })).toBe(false)
    expect(editor.commands.setLink({ href: 'mailto:user@example.com' })).toBe(true)
    editor.destroy()
  })
})
