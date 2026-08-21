import Placeholder from "@tiptap/extension-placeholder";
import { editorExtensions } from "@ricetext/editor-core";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AtSign,
  Bold,
  ChevronDown,
  Dice5,
  EyeOff,
  FileText,
  Heading1,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  MessageCirclePlus,
  MoreHorizontal,
  Quote,
  Redo2,
  Send,
  TextQuote,
  Underline as UnderlineIcon,
  Undo2,
  UnlockKeyhole,
} from "lucide-react";
import { useEffect, useMemo, useReducer, useState } from "react";
import {
  Button,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from "../../components/ui";
import type { EditorMode, RichTextNode } from "../../lib/types";
import { createId } from "../../lib/utils";
import {
  AttachmentDialog,
  DiceDialog,
  ExcerptDialog,
  ImageDialog,
  MentionDialog,
} from "./dialogs";

/** RichTextEditor 的稳定公共属性；宿主只需持有 JSON，不接触 ProseMirror 实例。 */
export interface RichTextEditorProps {
  content: RichTextNode;
  mode: EditorMode;
  editable?: boolean;
  longTextMode?: boolean;
  onChange: (content: RichTextNode) => void;
  /** 每次事务产生 ProseMirror steps 时回调，供增量同步使用。 */
  onChangeSteps?: (steps: unknown[]) => void;
  onSubmit?: () => void;
  onExpand?: () => void;
  onCommentAnchorOpen?: (threadId: string) => void;
  onModeToolsOpen?: () => void;
}

const colors = ["#20272c", "#197c73", "#b66a0a", "#b63434", "#6b4bb5"];

/** 把需要 Editor 的命令包装成稳定的按钮回调。 */
function cmd(
  editor: Editor | null,
  action: (editor: Editor) => boolean,
): () => void {
  return () => {
    if (editor) action(editor);
  };
}

/** 完整/移动 Sheet 共用的格式与业务节点工具栏。 */
function Toolbar({
  editor,
  condensed = false,
}: {
  editor: Editor | null;
  condensed?: boolean;
}) {
  const [diceOpen, setDiceOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [imageInitial, setImageInitial] = useState<{
    src: string;
    alt: string;
    caption: string;
    align: string;
    width: number;
  } | null>(null);
  const [imageAssetId, setImageAssetId] = useState<string | null>(null);
  const [excerptOpen, setExcerptOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [attachmentInitial, setAttachmentInitial] = useState<{
    name: string;
    mimeType: string;
    size: number;
    priceCoins: number;
  } | null>(null);
  const [, forceSelectionRender] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    if (!editor) return undefined;
    const update = () => forceSelectionRender();
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);
  if (!editor)
    return <div className="editor-toolbar h-[46px]" aria-hidden="true" />;
  const spoilerActive = editor.isActive("spoiler");

  const insert = (node: Record<string, unknown>) =>
    editor.chain().focus().insertContent(node).run();
  const addLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("输入 HTTP(S) 链接", previous ?? "https://");
    if (href === null) return;
    if (!/^https?:\/\//i.test(href)) {
      window.alert("仅允许 HTTP(S) 链接");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };
  const insertGate = () =>
    insert({
      type: "replyGate",
      attrs: { gateId: createId("gate"), prompt: "回复后可见" },
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "在这里编辑回复后可见的内容" }],
        },
      ],
    });
  const openImageDialog = () => {
    const attrs = editor.getAttributes("richImage") as
      | {
          src?: string;
          alt?: string;
          caption?: string;
          align?: string;
          width?: number;
          assetId?: string | null;
        }
      | undefined;
    const selection = editor.state.selection as {
      node?: { type?: { name?: string } };
    };
    const isImageSelected =
      editor.isActive("richImage") ||
      selection.node?.type?.name === "richImage";
    if (isImageSelected && attrs && typeof attrs.src === "string") {
      setImageInitial({
        src: attrs.src,
        alt: attrs.alt ?? "",
        caption: attrs.caption ?? "",
        align: attrs.align ?? "center",
        width: attrs.width ?? 80,
      });
      setImageAssetId(attrs.assetId ?? null);
    } else {
      setImageInitial(null);
      setImageAssetId(null);
    }
    setImageOpen(true);
  };
  const openAttachmentDialog = () => {
    const attrs = editor.getAttributes("attachmentRef") as
      | {
          attachmentId?: string;
          name?: string;
          mimeType?: string;
          size?: number;
          priceCoins?: number;
        }
      | undefined;
    const selection = editor.state.selection as {
      node?: { type?: { name?: string } };
    };
    const isAttachmentSelected =
      editor.isActive("attachmentRef") ||
      selection.node?.type?.name === "attachmentRef";
    if (isAttachmentSelected && attrs && typeof attrs.name === "string") {
      setAttachmentInitial({
        name: attrs.name,
        mimeType: attrs.mimeType ?? "application/octet-stream",
        size: attrs.size ?? 0,
        priceCoins: attrs.priceCoins ?? 0,
      });
    } else {
      setAttachmentInitial(null);
    }
    setAttachmentOpen(true);
  };

  return (
    <>
      <div className="editor-toolbar" role="toolbar" aria-label="富文本工具栏">
        <span className="toolbar-group">
          <IconButton
            label="撤销"
            onClick={cmd(editor, (value) => value.chain().focus().undo().run())}
            disabled={!editor.can().undo()}
          >
            <Undo2 size={16} />
          </IconButton>
          <IconButton
            label="重做"
            onClick={cmd(editor, (value) => value.chain().focus().redo().run())}
            disabled={!editor.can().redo()}
          >
            <Redo2 size={16} />
          </IconButton>
        </span>
        <span className="toolbar-group">
          <IconButton
            label="加粗"
            active={editor.isActive("bold")}
            disabled={spoilerActive}
            onClick={cmd(editor, (value) =>
              value.chain().focus().toggleBold().run(),
            )}
          >
            <Bold size={16} />
          </IconButton>
          <IconButton
            label="斜体"
            active={editor.isActive("italic")}
            disabled={spoilerActive}
            onClick={cmd(editor, (value) =>
              value.chain().focus().toggleItalic().run(),
            )}
          >
            <Italic size={16} />
          </IconButton>
          <IconButton
            label="下划线"
            active={editor.isActive("underline")}
            onClick={cmd(editor, (value) =>
              value.chain().focus().toggleUnderline().run(),
            )}
          >
            <UnderlineIcon size={16} />
          </IconButton>
          {!condensed && (
            <>
              <IconButton
                label="一级标题"
                active={editor.isActive("heading", { level: 1 })}
                onClick={cmd(editor, (value) =>
                  value.chain().focus().toggleHeading({ level: 1 }).run(),
                )}
              >
                <Heading1 size={16} />
              </IconButton>
              <IconButton
                label="二级标题"
                active={editor.isActive("heading", { level: 2 })}
                onClick={cmd(editor, (value) =>
                  value.chain().focus().toggleHeading({ level: 2 }).run(),
                )}
              >
                <Heading2 size={16} />
              </IconButton>
            </>
          )}
        </span>
        {!condensed && (
          <span className="toolbar-group">
            <select
              aria-label="字号"
              disabled={spoilerActive}
              className="h-8 w-[72px] rounded border border-input bg-white px-1 text-xs"
              value={
                (editor.getAttributes("textStyle").fontSize as
                  string | undefined) ?? "16px"
              }
              onChange={(event) =>
                editor
                  .chain()
                  .focus()
                  .setMark("textStyle", {
                    ...editor.getAttributes("textStyle"),
                    fontSize: event.target.value,
                  })
                  .run()
              }
            >
              <option>12px</option>
              <option>14px</option>
              <option>16px</option>
              <option>18px</option>
              <option>20px</option>
              <option>24px</option>
              <option>28px</option>
              <option>32px</option>
            </select>
            <select
              aria-label="字体"
              disabled={spoilerActive}
              className="h-8 w-[86px] rounded border border-input bg-white px-1 text-xs"
              value={
                (editor.getAttributes("textStyle").fontFamily as
                  string | undefined) ?? ""
              }
              onChange={(event) =>
                event.target.value
                  ? editor
                      .chain()
                      .focus()
                      .setFontFamily(event.target.value)
                      .run()
                  : editor.chain().focus().unsetFontFamily().run()
              }
            >
              <option value="">默认字体</option>
              <option value="sans-serif">黑体</option>
              <option value="Noto Serif SC">宋体</option>
              <option value="monospace">等宽</option>
            </select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label="文字颜色"
                  disabled={spoilerActive}
                >
                  <span
                    className="h-4 w-4 rounded-sm border border-black/15"
                    style={{
                      background:
                        (editor.getAttributes("textStyle").color as
                          string | undefined) ?? "#20272c",
                    }}
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-0">
                <div className="flex gap-1 p-1">
                  {colors.map((color) => (
                    <button
                      key={color}
                      aria-label={`文字颜色 ${color}`}
                      className="h-7 w-7 rounded border border-black/10"
                      style={{ background: color }}
                      onClick={() =>
                        editor.chain().focus().setColor(color).run()
                      }
                    />
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        )}
        {!condensed && (
          <span className="toolbar-group">
            <IconButton
              label="无序列表"
              active={editor.isActive("bulletList")}
              onClick={cmd(editor, (value) =>
                value.chain().focus().toggleBulletList().run(),
              )}
            >
              <List size={16} />
            </IconButton>
            <IconButton
              label="有序列表"
              active={editor.isActive("orderedList")}
              onClick={cmd(editor, (value) =>
                value.chain().focus().toggleOrderedList().run(),
              )}
            >
              <ListOrdered size={16} />
            </IconButton>
            <IconButton
              label="引用"
              active={editor.isActive("blockquote")}
              onClick={cmd(editor, (value) =>
                value.chain().focus().toggleBlockquote().run(),
              )}
            >
              <Quote size={16} />
            </IconButton>
            <IconButton
              label="左对齐"
              active={editor.isActive({ textAlign: "left" })}
              onClick={cmd(editor, (value) =>
                value.chain().focus().setTextAlign("left").run(),
              )}
            >
              <AlignLeft size={16} />
            </IconButton>
            <IconButton
              label="居中"
              active={editor.isActive({ textAlign: "center" })}
              onClick={cmd(editor, (value) =>
                value.chain().focus().setTextAlign("center").run(),
              )}
            >
              <AlignCenter size={16} />
            </IconButton>
            <IconButton
              label="右对齐"
              active={editor.isActive({ textAlign: "right" })}
              onClick={cmd(editor, (value) =>
                value.chain().focus().setTextAlign("right").run(),
              )}
            >
              <AlignRight size={16} />
            </IconButton>
          </span>
        )}
        <span className="toolbar-group">
          {!condensed && (
            <IconButton
              label="链接"
              active={editor.isActive("link")}
              onClick={addLink}
            >
              <Link2 size={16} />
            </IconButton>
          )}
          <IconButton label="图片" onClick={openImageDialog}>
            <ImagePlus size={16} />
          </IconButton>
          <IconButton label="骰子" onClick={() => setDiceOpen(true)}>
            <Dice5 size={16} />
          </IconButton>
          <IconButton label="附件" onClick={openAttachmentDialog}>
            <FileText size={16} />
          </IconButton>
          {!condensed && (
            <>
              <IconButton
                label="间贴锚点"
                onClick={() =>
                  insert({
                    type: "inlineCommentAnchor",
                    attrs: {
                      threadId: createId("thread"),
                      count: 0,
                      placement: "end",
                    },
                  })
                }
              >
                <MessageCirclePlus size={16} />
              </IconButton>
              <IconButton label="@ 用户" onClick={() => setMentionOpen(true)}>
                <AtSign size={16} />
              </IconButton>
              <IconButton
                label="黑幕"
                active={editor.isActive("spoiler")}
                onClick={() => editor.chain().focus().toggleSpoiler().run()}
              >
                <EyeOff size={16} />
              </IconButton>
            </>
          )}
        </span>
        {!condensed && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                aria-label="更多插入"
              >
                <MoreHorizontal size={17} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setExcerptOpen(true)}>
                <TextQuote size={15} />
                小说摘录
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={insertGate}>
                <UnlockKeyhole size={15} />
                回复后可见
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={openAttachmentDialog}>
                <FileText size={15} />
                附件引用
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  insert({
                    type: "pollRef",
                    attrs: {
                      pollId: createId("poll"),
                      question: "下一章先跟随哪位角色？",
                      multiple: false,
                      options: [
                        { id: "keeper", label: "灯塔守望人" },
                        { id: "postman", label: "失踪的邮差" },
                        { id: "clerk", label: "港务局记录员" },
                      ],
                    },
                  })
                }
              >
                <List size={15} />
                投票
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <DiceDialog
        open={diceOpen}
        onOpenChange={setDiceOpen}
        onInsert={(result) => insert({ type: "diceRoll", attrs: result })}
      />
      <ImageDialog
        open={imageOpen}
        onOpenChange={setImageOpen}
        {...(imageInitial ? { initial: imageInitial } : {})}
        onInsert={(asset, values) => {
          if (imageInitial) {
            const nextAssetId =
              asset?.assetId ??
              (values.src === imageInitial.src ? imageAssetId : null);
            editor
              .chain()
              .focus()
              .updateAttributes("richImage", {
                assetId: nextAssetId,
                ...values,
              })
              .run();
          } else {
            insert({
              type: "richImage",
              attrs: { assetId: asset?.assetId ?? null, ...values },
            });
          }
        }}
      />
      <AttachmentDialog
        open={attachmentOpen}
        onOpenChange={setAttachmentOpen}
        {...(attachmentInitial ? { initial: attachmentInitial } : {})}
        onInsert={(values) => {
          if (attachmentInitial) {
            editor
              .chain()
              .focus()
              .updateAttributes("attachmentRef", values)
              .run();
          } else {
            insert({
              type: "attachmentRef",
              attrs: { attachmentId: createId("attachment"), ...values },
            });
          }
        }}
      />
      <ExcerptDialog
        open={excerptOpen}
        onOpenChange={setExcerptOpen}
        onInsert={(values) =>
          insert({
            type: "novelExcerpt",
            attrs: {
              bookTitle: values.bookTitle,
              chapterTitle: values.chapterTitle,
              author: values.author,
              sourceUrl: values.sourceUrl || null,
              variant: values.variant,
            },
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: values.text }],
              },
            ],
          })
        }
      />
      <MentionDialog
        open={mentionOpen}
        onOpenChange={setMentionOpen}
        onInsert={(user) =>
          insert({
            type: "mention",
            attrs: {
              userId: user.id,
              name: user.name,
              resolved: user.resolved,
              avatarUrl: user.avatarUrl,
            },
          })
        }
      />
    </>
  );
}

/** Web 宿主编辑器：复用 editor-core schema，并按 compact/full/mobile 组合不同工具表面。 */
export function RichTextEditor({
  content,
  mode,
  editable = true,
  longTextMode = false,
  onChange,
  onChangeSteps,
  onSubmit,
  onExpand,
  onCommentAnchorOpen,
  onModeToolsOpen,
}: RichTextEditorProps) {
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const extensions = useMemo(
    () =>
      editorExtensions({
        additionalExtensions: [
          Placeholder.configure({
            placeholder: mode === "compact" ? "写下回复…" : "开始写作…",
          }),
        ],
      }),
    [mode],
  );
  const editor = useEditor({
    extensions,
    content,
    editable,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor: value, transaction }) => {
      onChange(value.getJSON() as RichTextNode);
      onChangeSteps?.(transaction.steps.map((step) => step.toJSON()));
    },
    editorProps: {
      attributes: {
        "aria-label": mode === "compact" ? "快速回复编辑区" : "正文编辑区",
      },
      handleClickOn(_view, _pos, node) {
        if (node.type.name === "inlineCommentAnchor") {
          onCommentAnchorOpen?.(String(node.attrs.threadId));
          return true;
        }
        return false;
      },
    },
  });

  // 权限或首屏加载状态变化时，只切换编辑能力，不重建 ProseMirror 实例。
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);
  // 回滚/远端装载属于受控更新；emitUpdate=false 防止被误判为新的用户编辑代次。
  useEffect(() => {
    if (!editor || JSON.stringify(editor.getJSON()) === JSON.stringify(content))
      return;
    editor.commands.setContent(content, { emitUpdate: false });
  }, [content, editor]);
  // 显式销毁 EditorView，避免路由切换后残留 DOM 监听器。
  useEffect(() => () => editor?.destroy(), [editor]);

  if (longTextMode)
    return (
      <div className="surface mobile-edge overflow-clip">
        <div className="document-bar">
          <div className="min-w-0">
            <p className="document-title">长文本编辑</p>
          </div>
          {onSubmit ? (
            <Button size="sm" onClick={onSubmit}>
              <Send size={14} />
              保存
            </Button>
          ) : null}
        </div>
        <div className="editor-content-wrap">
          <EditorContent editor={editor} />
        </div>
      </div>
    );

  if (mode === "compact")
    return (
      <div className="compact-shell surface mobile-edge">
        <div className="editor-content-wrap">
          <EditorContent editor={editor} />
        </div>
        <div className="compact-actions">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontal size={16} />
                更多
                <ChevronDown size={13} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => onExpand?.()}>
                <TextQuote size={15} />
                切换完整编辑器
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onModeToolsOpen?.()}>
                <ImagePlus size={15} />
                插入图片或骰子
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={onSubmit}>
            <Send size={15} />
            发布回复
          </Button>
        </div>
      </div>
    );

  if (mode === "mobile")
    return (
      <>
        <div className="mobile-editor surface mobile-edge">
          <div className="editor-content-wrap">
            <EditorContent editor={editor} />
          </div>
          <div className="mobile-toolbar">
            <IconButton
              label="加粗"
              active={Boolean(editor?.isActive("bold"))}
              disabled={Boolean(editor?.isActive("spoiler"))}
              onClick={cmd(editor, (value) =>
                value.chain().focus().toggleBold().run(),
              )}
            >
              <Bold size={18} />
            </IconButton>
            <IconButton
              label="插入图片"
              onClick={() => setMobileToolsOpen(true)}
            >
              <ImagePlus size={18} />
            </IconButton>
            <IconButton
              label="插入骰子"
              onClick={() => setMobileToolsOpen(true)}
            >
              <Dice5 size={18} />
            </IconButton>
            <IconButton
              label="更多工具"
              onClick={() => setMobileToolsOpen(true)}
            >
              <MoreHorizontal size={19} />
            </IconButton>
            <Button size="icon" aria-label="发布" onClick={onSubmit}>
              <Send size={18} />
            </Button>
          </div>
        </div>
        <Dialog
          open={mobileToolsOpen}
          onOpenChange={setMobileToolsOpen}
          title="编辑工具"
          description="选择排版或插入内容。"
          className="!bottom-0 !top-auto !w-full !max-w-none !translate-y-0 rounded-b-none"
        >
          <Toolbar editor={editor} />
        </Dialog>
      </>
    );

  return (
    <div className="surface mobile-edge overflow-clip">
      <Toolbar editor={editor} />
      <div className="editor-content-wrap">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export function CompactInsertMenu({ editor }: { editor: Editor | null }) {
  return editor ? <Toolbar editor={editor} condensed /> : null;
}
