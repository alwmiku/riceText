import type { Editor, Extensions, JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useReducer, useState } from "react";

import { editorExtensions } from "./extensions.js";
import {
  ALLOWED_FONT_FAMILIES,
  ALLOWED_FONT_SIZES,
  sanitizeDocument,
  sanitizeUrl,
} from "./sanitize.js";
import type { EditorMode } from "./types.js";

/** Context emitted with every safe editor update. */
export interface EditorChangeContext {
  /** Live Tiptap editor instance that produced the update. */
  editor: Editor;
  /** Whether the sanitized JSON differs from the editor's raw JSON. */
  sanitized: boolean;
}

/** Optional callbacks used to launch application-owned insertion dialogs. */
export interface EditorActionRequests {
  /** Opens the image upload or external-URL flow. */
  onRequestImage?: (editor: Editor) => void;
  /** Opens the persisted dice-roll flow. */
  onRequestDice?: (editor: Editor) => void;
  /** Creates or attaches an inline-comment thread. */
  onRequestComment?: (editor: Editor) => void;
  /** Opens the source metadata form for a novel excerpt. */
  onRequestNovelExcerpt?: (editor: Editor) => void;
  /** Opens friend and server-side user search. */
  onRequestMention?: (editor: Editor) => void;
  /** Opens the reply-gated content flow. */
  onRequestReplyGate?: (editor: Editor) => void;
  /** Opens the attachment upload and pricing flow. */
  onRequestAttachment?: (editor: Editor) => void;
  /** Opens the poll builder. */
  onRequestPoll?: (editor: Editor) => void;
  /** Opens an application-owned link dialog instead of the default prompt. */
  onRequestLink?: (editor: Editor) => void;
}

/** Props for the reusable editor toolbar. */
export interface EditorToolbarProps extends EditorActionRequests {
  /** Active Tiptap editor instance. */
  editor: Editor;
  /** Visual density of the toolbar. */
  mode?: EditorMode;
  /** Disables all toolbar controls. */
  disabled?: boolean;
  /** Called with sanitized JSON when the submit command is activated. */
  onSubmit?: (content: JSONContent, editor: Editor) => void | Promise<void>;
}

/** Props for the shared Tiptap editor component. */
export interface RichTextEditorProps extends EditorActionRequests {
  /** Controlled Tiptap JSON document. Untrusted values are sanitized first. */
  content: JSONContent;
  /** Called for each transaction that changes document content. */
  onChange?: (content: JSONContent, context: EditorChangeContext) => void;
  /** Called with ProseMirror transaction steps for incremental sync. */
  onChangeSteps?: (steps: unknown[], editor: Editor) => void;
  /** Called when the editor has initialized and can accept commands. */
  onReady?: (editor: Editor) => void;
  /** Called when the preset's submit button is activated. */
  onSubmit?: (content: JSONContent, editor: Editor) => void | Promise<void>;
  /** Compact, full-page, or touch-oriented layout. */
  mode?: EditorMode;
  /** Additional class applied to the outer editor shell. */
  className?: string;
  /** Accessible name for the editable region. */
  ariaLabel?: string;
  /** Placeholder rendered by CSS when the document is empty. */
  placeholder?: string;
  /** Whether the content can be edited. Defaults to `true`. */
  editable?: boolean;
  /** Whether to focus the editor during initialization. */
  autofocus?: boolean | "start" | "end" | "all" | number;
  /** Additional Tiptap extensions appended after the canonical schema. */
  extensions?: Extensions;
  /** Replaces the default toolbar while retaining the preset shell. */
  renderToolbar?: (editor: Editor) => ReactNode;
  /** Optional save state or status content rendered beside shell actions. */
  status?: ReactNode;
}

interface ToolbarButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  onPress: () => void;
}

function ToolbarButton({
  label,
  active = false,
  disabled = false,
  children,
  onPress,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className="rt-toolbar__button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

function setDefaultLink(editor: Editor): void {
  if (editor.isActive("link")) {
    editor.chain().focus().unsetLink().run();
    return;
  }
  if (typeof window === "undefined") return;
  const candidate = window.prompt("Link URL");
  const href = sanitizeUrl(candidate, "link");
  if (href)
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
}

/**
 * Headless-styled formatting toolbar shared by all three editor presets.
 * Product applications can replace it through `RichTextEditor.renderToolbar`.
 */
export function EditorToolbar({
  editor,
  mode = "full",
  disabled = false,
  onSubmit,
  ...requests
}: EditorToolbarProps) {
  const [, forceSelectionRender] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const update = () => forceSelectionRender();
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  const preventDisabled = disabled || !editor.isEditable;
  const spoilerActive = editor.isActive("spoiler");
  const request = (callback: ((value: Editor) => void) | undefined) => () =>
    callback?.(editor);
  return (
    <div
      className={`rt-toolbar rt-toolbar--${mode}`}
      role="toolbar"
      aria-label="Rich text formatting"
    >
      <div className="rt-toolbar__group">
        <ToolbarButton
          label="Undo"
          disabled={preventDisabled || !editor.can().undo()}
          onPress={() => editor.chain().focus().undo().run()}
        >
          ↶
        </ToolbarButton>
        <ToolbarButton
          label="Redo"
          disabled={preventDisabled || !editor.can().redo()}
          onPress={() => editor.chain().focus().redo().run()}
        >
          ↷
        </ToolbarButton>
      </div>
      <div className="rt-toolbar__group">
        <ToolbarButton
          label="Bold"
          active={editor.isActive("bold")}
          disabled={preventDisabled || spoilerActive}
          onPress={() => editor.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={editor.isActive("italic")}
          disabled={preventDisabled || spoilerActive}
          onPress={() => editor.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton
          label="Underline"
          active={editor.isActive("underline")}
          disabled={preventDisabled}
          onPress={() => editor.chain().focus().toggleUnderline().run()}
        >
          <u>U</u>
        </ToolbarButton>
        <ToolbarButton
          label="Strikethrough"
          active={editor.isActive("strike")}
          disabled={preventDisabled}
          onPress={() => editor.chain().focus().toggleStrike().run()}
        >
          <s>S</s>
        </ToolbarButton>
        <ToolbarButton
          label="Spoiler"
          active={editor.isActive("spoiler")}
          disabled={preventDisabled}
          onPress={() => editor.chain().focus().toggleSpoiler().run()}
        >
          ◼
        </ToolbarButton>
        <ToolbarButton
          label="Link"
          active={editor.isActive("link")}
          disabled={preventDisabled}
          onPress={
            requests.onRequestLink
              ? request(requests.onRequestLink)
              : () => setDefaultLink(editor)
          }
        >
          ↗
        </ToolbarButton>
      </div>
      {mode !== "compact" ? (
        <>
          <div className="rt-toolbar__group">
            <label className="rt-toolbar__field">
              <span className="rt-sr-only">Block style</span>
              <select
                aria-label="Block style"
                disabled={preventDisabled}
                value={
                  editor.isActive("heading", { level: 1 })
                    ? "h1"
                    : editor.isActive("heading", { level: 2 })
                      ? "h2"
                      : editor.isActive("heading", { level: 3 })
                        ? "h3"
                        : "p"
                }
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (value === "p")
                    editor.chain().focus().setParagraph().run();
                  else
                    editor
                      .chain()
                      .focus()
                      .setHeading({
                        level: Number(value.slice(1)) as 1 | 2 | 3,
                      })
                      .run();
                }}
              >
                <option value="p">Text</option>
                <option value="h1">H1</option>
                <option value="h2">H2</option>
                <option value="h3">H3</option>
              </select>
            </label>
            <label className="rt-toolbar__field">
              <span className="rt-sr-only">Font family</span>
              <select
                aria-label="Font family"
                disabled={preventDisabled || spoilerActive}
                value={String(
                  editor.getAttributes("textStyle").fontFamily ?? "system-ui",
                )}
                onChange={(event) =>
                  editor
                    .chain()
                    .focus()
                    .setFontFamily(event.currentTarget.value)
                    .run()
                }
              >
                {ALLOWED_FONT_FAMILIES.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
            </label>
            <label className="rt-toolbar__field rt-toolbar__field--short">
              <span className="rt-sr-only">Font size</span>
              <select
                aria-label="Font size"
                disabled={preventDisabled || spoilerActive}
                value={String(
                  editor.getAttributes("textStyle").fontSize ?? "16px",
                )}
                onChange={(event) =>
                  editor
                    .chain()
                    .focus()
                    .setFontSize(event.currentTarget.value)
                    .run()
                }
              >
                {ALLOWED_FONT_SIZES.map((size) => (
                  <option key={size} value={`${size}px`}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <input
              className="rt-toolbar__color"
              aria-label="Text color"
              title="Text color"
              type="color"
              disabled={preventDisabled || spoilerActive}
              value={String(
                editor.getAttributes("textStyle").color ?? "#1f2937",
              )}
              onChange={(event) =>
                editor.chain().focus().setColor(event.currentTarget.value).run()
              }
            />
          </div>
          <div className="rt-toolbar__group">
            <ToolbarButton
              label="Bullet list"
              active={editor.isActive("bulletList")}
              disabled={preventDisabled}
              onPress={() => editor.chain().focus().toggleBulletList().run()}
            >
              •≡
            </ToolbarButton>
            <ToolbarButton
              label="Numbered list"
              active={editor.isActive("orderedList")}
              disabled={preventDisabled}
              onPress={() => editor.chain().focus().toggleOrderedList().run()}
            >
              1≡
            </ToolbarButton>
            <ToolbarButton
              label="Block quote"
              active={editor.isActive("blockquote")}
              disabled={preventDisabled}
              onPress={() => editor.chain().focus().toggleBlockquote().run()}
            >
              ❝
            </ToolbarButton>
            <ToolbarButton
              label="Align left"
              active={editor.isActive({ textAlign: "left" })}
              disabled={preventDisabled}
              onPress={() => editor.chain().focus().setTextAlign("left").run()}
            >
              ≡
            </ToolbarButton>
            <ToolbarButton
              label="Align center"
              active={editor.isActive({ textAlign: "center" })}
              disabled={preventDisabled}
              onPress={() =>
                editor.chain().focus().setTextAlign("center").run()
              }
            >
              ≣
            </ToolbarButton>
            <ToolbarButton
              label="Align right"
              active={editor.isActive({ textAlign: "right" })}
              disabled={preventDisabled}
              onPress={() => editor.chain().focus().setTextAlign("right").run()}
            >
              ≡
            </ToolbarButton>
          </div>
          <div className="rt-toolbar__group">
            {requests.onRequestComment ? (
              <ToolbarButton
                label="Inline comment"
                disabled={preventDisabled}
                onPress={request(requests.onRequestComment)}
              >
                ☵
              </ToolbarButton>
            ) : null}
            {requests.onRequestImage ? (
              <ToolbarButton
                label="Insert image"
                active={editor.isActive("richImage")}
                disabled={preventDisabled}
                onPress={request(requests.onRequestImage)}
              >
                ▧
              </ToolbarButton>
            ) : null}
            {requests.onRequestDice ? (
              <ToolbarButton
                label="Roll dice"
                active={editor.isActive("diceRoll")}
                disabled={preventDisabled}
                onPress={request(requests.onRequestDice)}
              >
                ⚄
              </ToolbarButton>
            ) : null}
            {requests.onRequestNovelExcerpt ? (
              <ToolbarButton
                label="Novel excerpt"
                active={editor.isActive("novelExcerpt")}
                disabled={preventDisabled}
                onPress={request(requests.onRequestNovelExcerpt)}
              >
                ▤
              </ToolbarButton>
            ) : null}
            {requests.onRequestMention ? (
              <ToolbarButton
                label="Mention user"
                active={editor.isActive("mention")}
                disabled={preventDisabled}
                onPress={request(requests.onRequestMention)}
              >
                @
              </ToolbarButton>
            ) : null}
            {requests.onRequestReplyGate ? (
              <ToolbarButton
                label="Reply-gated content"
                disabled={preventDisabled}
                onPress={request(requests.onRequestReplyGate)}
              >
                ◉
              </ToolbarButton>
            ) : null}
            {requests.onRequestAttachment ? (
              <ToolbarButton
                label="Attachment"
                active={editor.isActive("attachmentRef")}
                disabled={preventDisabled}
                onPress={request(requests.onRequestAttachment)}
              >
                ⌕
              </ToolbarButton>
            ) : null}
            {requests.onRequestPoll ? (
              <ToolbarButton
                label="Poll"
                active={editor.isActive("pollRef")}
                disabled={preventDisabled}
                onPress={request(requests.onRequestPoll)}
              >
                ▥
              </ToolbarButton>
            ) : null}
          </div>
        </>
      ) : null}
      {onSubmit ? (
        <button
          type="button"
          className="rt-toolbar__submit"
          disabled={preventDisabled}
          onClick={() =>
            void onSubmit(sanitizeDocument(editor.getJSON()), editor)
          }
        >
          Submit
        </button>
      ) : null}
    </div>
  );
}

/**
 * Shared controlled Tiptap editor with compact, full, and mobile presentation
 * presets. The component emits sanitized JSON and never accepts raw HTML.
 */
export function RichTextEditor({
  content,
  onChange,
  onChangeSteps,
  onReady,
  onSubmit,
  mode = "full",
  className = "",
  ariaLabel = "Rich text editor",
  placeholder = "Write something…",
  editable = true,
  autofocus = false,
  extensions,
  renderToolbar,
  status,
  ...requests
}: RichTextEditorProps) {
  const [compactExpanded, setCompactExpanded] = useState(false);
  const initialContent = useMemo(() => sanitizeDocument(content), []);
  const configuredExtensions = useMemo(
    () =>
      editorExtensions({
        additionalExtensions: extensions ?? [],
        resizableImages: true,
      }),
    [extensions],
  );
  const editor = useEditor({
    extensions: configuredExtensions,
    content: initialContent,
    editable,
    autofocus,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: "rt-editor__content",
        "aria-label": ariaLabel,
        "data-placeholder": placeholder,
      },
    },
    onUpdate: ({ editor: updatedEditor, transaction }) => {
      const raw = updatedEditor.getJSON();
      const safe = sanitizeDocument(raw);
      onChange?.(safe, {
        editor: updatedEditor,
        sanitized: JSON.stringify(raw) !== JSON.stringify(safe),
      });
      onChangeSteps?.(
        transaction.steps.map((step) => step.toJSON()),
        updatedEditor,
      );
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    if (!editor) return;
    const safe = sanitizeDocument(content);
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(safe))
      editor.commands.setContent(safe, { emitUpdate: false });
  }, [content, editor]);

  useEffect(() => {
    if (editor) onReady?.(editor);
  }, [editor, onReady]);

  if (!editor)
    return (
      <div
        className={`rt-editor rt-editor--${mode} ${className}`}
        aria-busy="true"
      />
    );

  const toolbarMode = mode === "compact" && compactExpanded ? "full" : mode;
  const toolbar = renderToolbar?.(editor) ?? (
    <EditorToolbar
      editor={editor}
      mode={toolbarMode}
      disabled={!editable}
      {...requests}
      {...(onSubmit && mode !== "compact" ? { onSubmit } : {})}
    />
  );
  return (
    <section
      className={`rt-editor rt-editor--${mode} ${className}`}
      data-editor-mode={mode}
    >
      {mode === "compact" ? (
        <div className="rt-editor__compact-actions">
          {status ? <div className="rt-editor__status">{status}</div> : null}
          {onSubmit ? (
            <button
              type="button"
              className="rt-toolbar__submit"
              disabled={!editable}
              onClick={() =>
                void onSubmit(sanitizeDocument(editor.getJSON()), editor)
              }
            >
              Submit
            </button>
          ) : null}
          <button
            type="button"
            className="rt-editor__expand"
            aria-expanded={compactExpanded}
            onClick={() => setCompactExpanded((value) => !value)}
          >
            {compactExpanded ? "Hide tools" : "More tools"}
          </button>
        </div>
      ) : (
        toolbar
      )}
      <EditorContent editor={editor} />
      {mode === "compact" && compactExpanded ? toolbar : null}
      {mode !== "compact" && status ? (
        <div className="rt-editor__status">{status}</div>
      ) : null}
    </section>
  );
}
