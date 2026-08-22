import type { Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AtSign,
  Bold,
  Dice5,
  Eraser,
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
  Quote,
  Redo2,
  TextQuote,
  Underline as UnderlineIcon,
  Undo2,
  UnlockKeyhole,
  Vote,
  XCircle,
} from "lucide-react";
import { useEffect, useReducer, useState } from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
} from "../../components/ui";
import { createId } from "../../lib/utils";
import {
  cmd,
  isContainerNodeActive,
  isRichNodeActive,
  unwrapOutermostReplyGate,
} from "./commands";
import {
  AttachmentDialog,
  DiceDialog,
  ExcerptDialog,
  ImageDialog,
  MentionDialog,
  PollDialog,
  type PollDialogValues,
} from "./dialogs";

const colors = ["#20272c", "#197c73", "#b66a0a", "#b63434", "#6b4bb5"];

/** 完整/移动 Sheet 共用的格式与业务节点工具栏。 */
export function Toolbar({
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
  const [pollOpen, setPollOpen] = useState(false);
  const [pollInitial, setPollInitial] = useState<PollDialogValues | null>(null);
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
  const imageActive = isRichNodeActive(editor, "richImage");
  const diceActive = isRichNodeActive(editor, "diceRoll");
  const attachmentActive = isRichNodeActive(editor, "attachmentRef");
  const mentionActive = isRichNodeActive(editor, "mention");
  const commentAnchorActive = isRichNodeActive(editor, "inlineCommentAnchor");
  const excerptActive = isContainerNodeActive(editor, "novelExcerpt");
  const replyGateActive = isContainerNodeActive(editor, "replyGate");
  const pollActive = isRichNodeActive(editor, "pollRef");

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
  const openPollDialog = () => {
    const attrs = editor.getAttributes("pollRef") as {
      question?: unknown;
      multiple?: unknown;
      options?: unknown;
    };
    const options = Array.isArray(attrs.options)
      ? attrs.options.flatMap((option) => {
          if (
            !option ||
            typeof option !== "object" ||
            typeof (option as { id?: unknown }).id !== "string" ||
            typeof (option as { label?: unknown }).label !== "string"
          )
            return [];
          return [
            {
              id: (option as { id: string }).id,
              label: (option as { label: string }).label,
            },
          ];
        })
      : [];
    setPollInitial(
      pollActive && typeof attrs.question === "string" && options.length >= 2
        ? {
            question: attrs.question,
            multiple: attrs.multiple === true,
            options,
          }
        : null,
    );
    setPollOpen(true);
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
          <IconButton
            label="清除样式"
            onClick={cmd(editor, (value) =>
              value.chain().focus().unsetAllMarks().clearNodes().run(),
            )}
          >
            <Eraser size={16} />
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
          <IconButton
            label="图片"
            active={imageActive}
            onClick={openImageDialog}
          >
            <ImagePlus size={16} />
          </IconButton>
          <IconButton
            label="骰子"
            active={diceActive}
            onClick={() => setDiceOpen(true)}
          >
            <Dice5 size={16} />
          </IconButton>
          <IconButton
            label="附件"
            active={attachmentActive}
            onClick={openAttachmentDialog}
          >
            <FileText size={16} />
          </IconButton>
          {!condensed && (
            <>
              <IconButton
                label="间贴锚点"
                active={commentAnchorActive}
                disabled={replyGateActive}
                onClick={() => {
                  if (replyGateActive) return;
                  insert({
                    type: "inlineCommentAnchor",
                    attrs: {
                      threadId: createId("thread"),
                      count: 0,
                      placement: "end",
                    },
                  });
                }}
              >
                <MessageCirclePlus size={16} />
              </IconButton>
              <IconButton
                label="@ 用户"
                active={mentionActive}
                onClick={() => setMentionOpen(true)}
              >
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
          {!condensed && (
            <>
              <IconButton
                label="小说摘录"
                active={excerptActive}
                onClick={() => setExcerptOpen(true)}
              >
                <TextQuote size={16} />
              </IconButton>
              <IconButton
                label="回复后可见"
                active={replyGateActive}
                onClick={insertGate}
              >
                <UnlockKeyhole size={16} />
              </IconButton>
              <IconButton
                label="取消回复可见"
                disabled={!replyGateActive}
                onClick={() => unwrapOutermostReplyGate(editor)}
              >
                <XCircle size={16} />
              </IconButton>
              <IconButton
                label={pollActive ? "编辑投票" : "投票"}
                active={pollActive}
                onClick={openPollDialog}
              >
                <Vote size={16} />
              </IconButton>
            </>
          )}
        </span>
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
      <PollDialog
        open={pollOpen}
        onOpenChange={setPollOpen}
        {...(pollInitial ? { initial: pollInitial } : {})}
        onInsert={(values) => {
          if (pollInitial) {
            editor.chain().focus().updateAttributes("pollRef", values).run();
          } else {
            insert({
              type: "pollRef",
              attrs: { pollId: createId("poll"), ...values },
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
