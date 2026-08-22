import '@testing-library/jest-dom/vitest'

import type { Editor, JSONContent } from '@tiptap/core'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RichTextEditor } from './editor.js'

const emptyDocument: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

describe('RichTextEditor', () => {
  it('renders the full preset, updates formatting, and delegates feature actions', async () => {
    let editor: Editor | undefined
    const onChange = vi.fn()
    const onSubmit = vi.fn()
    const actions = {
      onRequestImage: vi.fn(),
      onRequestDice: vi.fn(),
      onRequestComment: vi.fn(),
      onRequestNovelExcerpt: vi.fn(),
      onRequestMention: vi.fn(),
      onRequestReplyGate: vi.fn(),
      onRequestAttachment: vi.fn(),
      onRequestPoll: vi.fn(),
      onRequestLink: vi.fn(),
    }

    const view = render(
      <RichTextEditor
        content={emptyDocument}
        mode="full"
        status={<span>Saved</span>}
        onReady={(value) => { editor = value }}
        onChange={onChange}
        onSubmit={onSubmit}
        {...actions}
      />,
    )

    await waitFor(() => expect(editor).toBeDefined())
    expect(view.container.querySelector('[data-editor-mode="full"]')).not.toBeNull()
    expect(screen.getByRole('toolbar', { name: 'Rich text formatting' })).toBeInTheDocument()
    expect(screen.getByText('Saved')).toBeInTheDocument()

    const actionLabels = [
      ['Inline comment', actions.onRequestComment],
      ['Insert image', actions.onRequestImage],
      ['Roll dice', actions.onRequestDice],
      ['Novel excerpt', actions.onRequestNovelExcerpt],
      ['Mention user', actions.onRequestMention],
      ['Reply-gated content', actions.onRequestReplyGate],
      ['Attachment', actions.onRequestAttachment],
      ['Poll', actions.onRequestPoll],
      ['Link', actions.onRequestLink],
    ] as const
    for (const [label, callback] of actionLabels) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(callback).toHaveBeenCalledWith(editor)
    }

    fireEvent.change(screen.getByRole('combobox', { name: 'Block style' }), { target: { value: 'h2' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Block style' }), { target: { value: 'p' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Font family' }), { target: { value: 'serif' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Font size' }), { target: { value: '18px' } })
    fireEvent.change(screen.getByLabelText('Text color'), { target: { value: '#0f766e' } })

    for (const label of ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Spoiler', 'Bullet list', 'Numbered list', 'Block quote', 'Align left', 'Align center', 'Align right']) {
      fireEvent.click(screen.getByRole('button', { name: label }))
    }

    act(() => {
      editor?.commands.setContent({
        type: 'doc',
        content: [{ type: 'richImage', attrs: { src: 'javascript:alert(1)', width: 999 } }],
      })
    })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.lastCall?.[1]).toMatchObject({ sanitized: true })

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ type: 'doc' }), editor)

    view.unmount()
  })

  it('renders resize handles for selected rich images', async () => {
    const content: JSONContent = {
      type: 'doc',
      content: [{ type: 'richImage', attrs: { assetId: null, src: '/uploads/a.png', alt: 'A', caption: '', align: 'center', width: 64 } }],
    }
    let editor: Editor | undefined
    const { container } = render(<RichTextEditor content={content} mode="full" onReady={(value) => { editor = value }} />)

    await waitFor(() => expect(editor).toBeDefined())
    expect(screen.getByRole('button', { name: 'Resize image from left edge' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resize image from right edge' })).toBeInTheDocument()
    expect(container.querySelector('.rt-rich-image')).toHaveStyle({ width: '64%' })
  })

  it('keeps compact tools hidden until expanded and submits sanitized content', async () => {
    const onSubmit = vi.fn()
    const { container } = render(
      <RichTextEditor content={emptyDocument} mode="compact" status="Draft" onSubmit={onSubmit} onRequestImage={vi.fn()} />,
    )

    await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull())
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ type: 'doc' }), expect.anything())

    const expand = screen.getByRole('button', { name: 'More tools' })
    fireEvent.click(expand)
    expect(screen.getByRole('button', { name: 'Hide tools' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('toolbar')).toHaveClass('rt-toolbar--full')
    expect(screen.getByRole('button', { name: 'Insert image' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hide tools' }))
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('supports the mobile preset, custom toolbar, controlled updates, and read-only state', async () => {
    let readyEditor: Editor | undefined
    const renderToolbar = vi.fn((editor: Editor) => <button type="button" onClick={() => editor.commands.clearContent()}>Custom tools</button>)
    const first: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] }
    const second: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }] }
    const { container, rerender } = render(
      <RichTextEditor content={first} mode="mobile" ariaLabel="Mobile composer" placeholder="Reply" renderToolbar={renderToolbar} onReady={(value) => { readyEditor = value }} />,
    )

    await waitFor(() => expect(readyEditor).toBeDefined())
    expect(container.querySelector('[data-editor-mode="mobile"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Custom tools' })).toBeInTheDocument()
    expect(container.querySelector('[aria-label="Mobile composer"]')).toHaveAttribute('data-placeholder', 'Reply')

    rerender(
      <RichTextEditor content={second} mode="mobile" editable={false} renderToolbar={renderToolbar} onReady={(value) => { readyEditor = value }} />,
    )
    await waitFor(() => expect(readyEditor?.getText()).toBe('Second'))
    expect(readyEditor?.isEditable).toBe(false)
  })

  it('uses the built-in safe link prompt and disables the default toolbar when read-only', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('https://example.com/path')
    const { rerender } = render(<RichTextEditor content={emptyDocument} mode="full" />)
    const link = await screen.findByRole('button', { name: 'Link' })
    fireEvent.click(link)
    expect(prompt).toHaveBeenCalledWith('Link URL')

    prompt.mockReturnValue('javascript:alert(1)')
    fireEvent.click(link)
    rerender(<RichTextEditor content={emptyDocument} mode="full" editable={false} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bold' })).toBeDisabled())
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()
    prompt.mockRestore()
  })
})
