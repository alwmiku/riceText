import { useQuery } from "@tanstack/react-query";
import {
  RichTextViewer,
  type AttachmentReferenceAttributes,
  type JSONContent,
  type PollReferenceAttributes,
  type RichTextViewerInteractions,
  type ViewerTocItem,
} from "@ricetext/editor-core";
import { BookOpen, Clock3, Eye, MessageCircle, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppContext } from "../app-context";
import { Badge, Dialog } from "../components/ui";
import { CommentThread } from "../features/comments/CommentThread";
import { TocSidebar } from "../features/viewer/TocSidebar";
import { getCommentThread, getDocument } from "../lib/api";
import { defaultDocument } from "../lib/seed";
import type { CommentReply } from "../lib/types";
import { formatTime } from "../lib/utils";

/** 纯阅读页面：只挂载静态 RichTextViewer，不创建 ProseMirror Editor。 */
export default function ReadPage() {
  const { identity } = useAppContext();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [ownedAttachments, setOwnedAttachments] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pollVotes, setPollVotes] = useState<Record<string, readonly string[]>>(
    {},
  );
  const [tocItems, setTocItems] = useState<readonly ViewerTocItem[]>([]);
  const { data: document = defaultDocument } = useQuery({
    queryKey: ["document", "demo-post"],
    queryFn: ({ signal }) => getDocument("demo-post", signal),
    placeholderData: defaultDocument,
  });
  const { data: comments = [] } = useQuery<CommentReply[]>({
    queryKey: ["comments", document.id, threadId],
    queryFn: () => getCommentThread(document.id, threadId!),
    enabled: Boolean(threadId),
  });
  // 业务数据通过 Viewer adapter 注入，正文 JSON 只保存稳定 ID 和必要的显示属性。
  const interactions = useMemo<RichTextViewerInteractions>(
    () => ({
      onInlineCommentActivate: (attrs) => setThreadId(attrs.threadId),
      isReplyGateVisible: () => false,
      onReplyGateRequest: () => setThreadId("thread_1"),
      renderMentionCard: (attrs) => (
        <span>
          <strong className="block">{attrs.name}</strong>
          <small>
            {attrs.resolved
              ? `已确认用户 · ${attrs.userId ?? ""}`
              : "等待服务器解析"}
          </small>
        </span>
      ),
      getAttachmentState: (attrs: AttachmentReferenceAttributes) => ({
        available:
          attrs.priceCoins === 0 || ownedAttachments.has(attrs.attachmentId),
        pending: false,
      }),
      onAttachmentActivate: (attrs: AttachmentReferenceAttributes) => {
        if (attrs.priceCoins > identity.coins) return;
        setOwnedAttachments((current) =>
          new Set(current).add(attrs.attachmentId),
        );
      },
      getPollState: (attrs: PollReferenceAttributes) => ({
        selectedOptionIds: pollVotes[attrs.pollId] ?? [],
        votesByOption: Object.fromEntries(
          attrs.options.map((option, index) => [
            option.id,
            [28, 19, 11][index] ?? 0,
          ]),
        ),
        // 演示环境：所有身份均可投票，避免作者身份下选项被禁用。
        canVote: true,
        pending: false,
      }),
      onPollSubmit: (attrs: PollReferenceAttributes, optionIds: readonly string[]) =>
        setPollVotes((current) => ({ ...current, [attrs.pollId]: [...optionIds] })),
      onPollVote: (attrs: PollReferenceAttributes, optionId: string) =>
        setPollVotes((current) => {
          const selected = current[attrs.pollId] ?? [];
          const next = attrs.multiple
            ? selected.includes(optionId)
              ? selected.filter((id) => id !== optionId)
              : [...selected, optionId]
            : [optionId];
          return { ...current, [attrs.pollId]: next };
        }),
    }),
    [identity, ownedAttachments, pollVotes],
  );
  const labels = useMemo(
    () => ({
      inlineComments: "打开间贴",
      rerollDice: "重新投掷",
      download: "下载",
      purchase: "购买",
      coins: "金币",
      votes: "票",
      source: "来源",
      closeImage: "关闭图片",
      previousImage: "上一张",
      nextImage: "下一张",
      zoomIn: "放大",
      zoomOut: "缩小",
      resetZoom: "重置缩放",
    }),
    [],
  );
  return (
    <main className="app-main">
      <div className="viewer-page">
        <article className="viewer-article">
          <div className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-4 font-sans text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <UserRound size={13} />
              林稻
            </span>
            <span className="flex items-center gap-1.5">
              <Clock3 size={13} />
              {formatTime(document.savedAt)}
            </span>
            <span className="flex items-center gap-1.5">
              <Eye size={13} />
              1,284
            </span>
            <Badge tone={document.storage === "local-demo" ? "amber" : "teal"}>
              {document.storage === "local-demo"
                ? "本地演示副本"
                : `版本 ${document.revision}`}
            </Badge>
          </div>
          <RichTextViewer
            content={document.content as JSONContent}
            interactions={interactions}
            labels={labels}
            onTocChange={setTocItems}
          />
        </article>
        <TocSidebar items={tocItems} />
        <aside className="viewer-aside">
          <div className="surface p-4">
            <p className="section-label">阅读位置</p>
            <div className="mt-3 flex items-start gap-3">
              <span className="grid h-9 w-9 place-items-center rounded bg-accent text-accent-foreground">
                <BookOpen size={17} />
              </span>
              <div>
                <strong className="block text-sm">雾港来信</strong>
                <small className="text-xs text-muted-foreground">
                  第三章 · 连载中
                </small>
              </div>
            </div>
            <div className="my-4 h-px bg-border" />
            <button
              type="button"
              className="flex w-full items-center justify-between text-xs text-muted-foreground"
              onClick={() => setThreadId("thread_1")}
            >
              <span className="flex items-center gap-2">
                <MessageCircle size={14} />
                本章间贴
              </span>
              <strong className="text-foreground">6</strong>
            </button>
          </div>
          <p className="mt-3 px-1 text-[10px] leading-4 text-muted-foreground">
            显示器仅渲染正文格式，不加载编辑工具或 contenteditable。
          </p>
        </aside>
      </div>
      <Dialog
        open={threadId !== null}
        onOpenChange={(open) => {
          if (!open) setThreadId(null);
        }}
        title="段落间贴"
        description="点击正文行首或行末的数字气泡可定位到对应回复树。"
        className="max-w-2xl"
      >
        <CommentThread identity={identity} initial={comments} compact />
      </Dialog>
    </main>
  );
}
