import type { Editor } from "@tiptap/react";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import { createId } from "../../../lib/utils";
import { isRichNodeActive, unwrapOutermostReplyGate } from "../commands";
import {
  insertCommentAnchor,
  insertNode,
  insertReplyGate,
} from "../editor-actions";
import {
  AttachmentDialog,
  DiceDialog,
  ExcerptDialog,
  ImageDialog,
  LinkDialog,
  MentionDialog,
  PollDialog,
  type PollDialogValues,
} from "../dialogs";
import type { InsertTool } from "../editor-tool-definitions";

type InsertRequest = (tool: InsertTool) => void;

const InsertRequestContext = createContext<InsertRequest | undefined>(
  undefined,
);

/**
 * 读取共享的插入请求通道。没有 ToolbarDialogs 包裹时返回 undefined，
 * 调用方应使用可选调用（requestInsert?.(tool)），行为与旧的
 * ricetext:context-insert 全局事件无监听器时一致。
 */
export function useInsertRequest(): InsertRequest | undefined {
  return useContext(InsertRequestContext);
}

interface ImageInitial {
  src: string;
  alt: string;
  caption: string;
  align: string;
  width: number;
}

interface AttachmentInitial {
  name: string;
  mimeType: string;
  size: number;
  priceCoins: number;
}

/**
 * 图片/附件/投票等插入对话框的唯一所有者：
 * - 持有全部 dialog 打开状态与编辑初始值；
 * - 通过 context 向工具栏、折叠菜单与右键菜单提供统一的 requestInsert 通道
 *   （取代旧的 document 级 ricetext:context-insert 事件）；
 * - 渲染所有对话框，onInsert 负责「更新选中节点」与「插入新节点」两分支。
 */
export function ToolbarDialogs({
  editor,
  children,
}: {
  editor: Editor | null;
  children: ReactNode;
}) {
  const [diceOpen, setDiceOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [imageInitial, setImageInitial] = useState<ImageInitial | null>(null);
  const [imageAssetId, setImageAssetId] = useState<string | null>(null);
  const [excerptOpen, setExcerptOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [attachmentInitial, setAttachmentInitial] =
    useState<AttachmentInitial | null>(null);
  const [pollOpen, setPollOpen] = useState(false);
  const [pollInitial, setPollInitial] = useState<PollDialogValues | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInitialHref, setLinkInitialHref] = useState<string | null>(null);
  const [linkCanRemove, setLinkCanRemove] = useState(false);
  const [linkNoSelectionOpen, setLinkNoSelectionOpen] = useState(false);

  const requestInsert = useCallback(
    (tool: InsertTool) => {
      if (!editor) return;
      switch (tool) {
        case "image": {
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
          break;
        }
        case "dice":
          setDiceOpen(true);
          break;
        case "attachment": {
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
          break;
        }
        case "mention":
          setMentionOpen(true);
          break;
        case "poll": {
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
            isRichNodeActive(editor, "pollRef") &&
              typeof attrs.question === "string" &&
              options.length >= 2
              ? {
                  question: attrs.question,
                  multiple: attrs.multiple === true,
                  options,
                }
              : null,
          );
          setPollOpen(true);
          break;
        }
        case "excerpt":
          setExcerptOpen(true);
          break;
        case "link": {
          // 链接必须套在文字上：没有选区且光标不在已有链接上时，
          // 提示用户先选中文字（移动端与桌面共用这条通道）。
          if (editor.state.selection.empty && !editor.isActive("link")) {
            setLinkNoSelectionOpen(true);
            break;
          }
          const attrs = editor.getAttributes("link") as { href?: unknown };
          setLinkInitialHref(
            typeof attrs.href === "string" ? attrs.href : null,
          );
          setLinkCanRemove(editor.isActive("link"));
          setLinkOpen(true);
          break;
        }
        case "comment":
          insertCommentAnchor(editor);
          break;
        case "gate":
          insertReplyGate(editor);
          break;
        case "ungate":
          unwrapOutermostReplyGate(editor);
          break;
      }
    },
    [editor],
  );

  return (
    <InsertRequestContext.Provider value={requestInsert}>
      {children}
      {editor ? (
        <>
          <DiceDialog
            open={diceOpen}
            onOpenChange={setDiceOpen}
            onInsert={(result) =>
              insertNode(editor, { type: "diceRoll", attrs: result })
            }
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
                insertNode(editor, {
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
                insertNode(editor, {
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
                editor
                  .chain()
                  .focus()
                  .updateAttributes("pollRef", values)
                  .run();
              } else {
                insertNode(editor, {
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
              insertNode(editor, {
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
              insertNode(editor, {
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
          <LinkDialog
            open={linkOpen}
            onOpenChange={setLinkOpen}
            {...(linkInitialHref !== null
              ? { initialHref: linkInitialHref }
              : {})}
            {...(linkCanRemove
              ? {
                  onRemove: () =>
                    editor
                      .chain()
                      .focus()
                      .extendMarkRange("link")
                      .unsetLink()
                      .run(),
                }
              : {})}
            onInsert={(href) =>
              editor
                .chain()
                .focus()
                .extendMarkRange("link")
                .setLink({ href })
                .run()
            }
          />
          <AlertDialog
            open={linkNoSelectionOpen}
            onOpenChange={setLinkNoSelectionOpen}
          >
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>未选择文字</AlertDialogTitle>
                <AlertDialogDescription>
                  请先选中要添加链接的文字，再使用「链接」。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction>知道了</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </InsertRequestContext.Provider>
  );
}
