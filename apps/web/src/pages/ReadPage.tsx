import { useQuery } from "@tanstack/react-query";
import {
  RichTextViewer,
  type AttachmentReferenceAttributes,
  type JSONContent,
  type PollReferenceAttributes,
  type RichTextViewerInteractions,
} from "@ricetext/editor-core";
import {
  BookOpen,
  Clock3,
  Eye,
  GitCompareArrows,
  MessageCircle,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useAppContext } from "../app-context";
import { Badge, Button, Dialog } from "../components/ui";
import { CommentThread } from "../features/comments/CommentThread";
import { ProofreadView } from "../features/proofread/ProofreadView";
import { ReaderSuggestion } from "../features/proofread/ReaderSuggestion";
import { TocSidebar } from "../features/viewer/TocSidebar";
import { getCommentThread, getDocument, listSuggestions } from "../lib/api";
import { chapterTextLines, splitDocumentByHeadings } from "../lib/chapters";
import { defaultDocument } from "../lib/seed";
import type { CommentReply } from "../lib/types";
import { formatTime } from "../lib/utils";

/** 纯阅读页面：只挂载静态 RichTextViewer，不创建 ProseMirror Editor。 */
export default function ReadPage() {
  const { identity } = useAppContext();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [proofreading, setProofreading] = useState(false);
  const [ownedAttachments, setOwnedAttachments] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pollVotes, setPollVotes] = useState<Record<string, readonly string[]>>(
    {},
  );
  const [chapterIndex, setChapterIndex] = useState(1);
  const { data: document = defaultDocument } = useQuery({
    queryKey: ["document", "demo-post"],
    queryFn: ({ signal }) => getDocument("demo-post", signal),
    placeholderData: defaultDocument,
  });
  const { chapters } = useMemo(
    () => splitDocumentByHeadings(document.content as JSONContent),
    [document.content],
  );
  const activeIndex = Math.min(chapterIndex, Math.max(0, chapters.length - 1));
  const chapterDoc = useMemo<JSONContent>(
    () => ({ type: "doc", content: chapters[activeIndex]?.blocks ?? [] }),
    [chapters, activeIndex],
  );
  const { data: comments = [] } = useQuery<CommentReply[]>({
    queryKey: ["comments", document.id, threadId],
    queryFn: () => getCommentThread(document.id, threadId!),
    enabled: Boolean(threadId),
  });
  // 只有作者与版主可以进入校订：普通读者既看不到入口也不加载校订数据。
  const canProofread =
    identity.role === "author" || identity.role === "moderator";
  const { data: suggestions = [] } = useQuery({
    queryKey: ["forum", "suggestions", document.id],
    queryFn: ({ signal }) => listSuggestions(document.id, signal),
    enabled: canProofread,
  });
  // 目录联动：只取当前章的校订，其他章节的校订不会显示在本章视图中。
  const chapterId = chapters[activeIndex]?.id ?? "";
  const chapterSuggestions = useMemo(
    () => suggestions.filter((suggestion) => suggestion.chapterId === chapterId),
    [suggestions, chapterId],
  );
  const lines = useMemo(
    () => chapterTextLines(chapterDoc.content ?? []),
    [chapterDoc],
  );
  const changedLineNos = useMemo(
    () => [...new Set(chapterSuggestions.map((suggestion) => suggestion.lineNo))],
    [chapterSuggestions],
  );

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
        // 本地环境：所有身份均可投票，避免作者身份下选项被禁用。
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
    <main className="mx-auto max-w-[1600px] px-5 pt-[18px] pb-[42px] max-[840px]:px-2.5 max-[840px]:pt-3 max-[840px]:pb-7 max-[430px]:px-0 max-[430px]:pt-2 max-[430px]:pb-5">
      <div className="mx-auto grid max-w-[1320px] grid-cols-[200px_minmax(0,1fr)_280px] items-start gap-8 [&>nav]:order-1 [&>article]:order-2 [&>aside]:order-3 max-[1180px]:grid-cols-[minmax(0,1fr)_280px] max-[1180px]:[&>nav]:hidden max-[840px]:block max-[840px]:[&>nav]:hidden max-[840px]:[&>aside]:hidden">
        <article className="min-w-0 border border-border bg-white p-[clamp(28px,6vw,72px)] shadow-[0_8px_32px_rgb(25_36_45/0.05)] max-[840px]:p-[30px_22px] max-[430px]:border-x-0 max-[430px]:p-[28px_18px] max-[430px]:[&_.rt-viewer]:text-base max-[430px]:[&_.rt-viewer]:leading-[1.85] max-[430px]:[&_.rt-viewer_h1]:text-[25px]">
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
            <Badge tone={document.storage === "local-cache" ? "amber" : "teal"}>
              {document.storage === "local-cache"
                ? "本地缓存副本"
                : `版本 ${document.revision}`}
            </Badge>
            {canProofread && (
              <Button
                size="sm"
                variant={proofreading ? "outline" : "default"}
                className="ml-auto h-7 px-2.5"
                onClick={() => setProofreading((value) => !value)}
              >
                <GitCompareArrows size={13} />
                {proofreading ? "退出校订" : "开始校订"}
              </Button>
            )}
          </div>
          {proofreading && canProofread ? (
            <ProofreadView
              documentTitle={document.title}
              chapterTitle={chapters[activeIndex]?.title ?? "正文"}
              lines={lines}
              suggestions={chapterSuggestions}
              onExit={() => setProofreading(false)}
            />
          ) : identity.role === "reader" ? (
            <ReaderSuggestion
              key={`${document.id}:${chapterId}`}
              documentId={document.id}
              chapterId={chapterId}
              chapterTitle={chapters[activeIndex]?.title ?? "正文"}
              lines={lines}
            >
              <RichTextViewer
                content={chapterDoc}
                interactions={interactions}
                labels={labels}
              />
            </ReaderSuggestion>
          ) : (
            <RichTextViewer
              content={chapterDoc}
              interactions={interactions}
              labels={labels}
            />
          )}
        </article>
        <TocSidebar
          chapters={chapters}
          currentIndex={activeIndex}
          onSelect={setChapterIndex}
        />
        <aside className="sticky top-20">
          <div className="rounded-lg border border-border bg-white p-4 shadow-panel">
            <p className="text-xs font-semibold tracking-normal text-muted-foreground uppercase">阅读位置</p>
            <div className="mt-3 flex items-start gap-3">
              <span className="grid h-9 w-9 place-items-center rounded bg-accent text-accent-foreground">
                <BookOpen size={17} />
              </span>
              <div>
                <strong className="block text-sm">雾港来信</strong>
                <small className="text-xs text-muted-foreground">
                  {chapters[activeIndex]?.title ?? "连载中"} · 连载中
                </small>
              </div>
            </div>
            <div className="my-4 h-px bg-border" />
            {canProofread ? (
              <div className="rounded-md bg-[#f5f8f8] px-2 py-2 text-[11px] leading-5 text-muted-foreground">
                <p className="flex items-center gap-1 font-semibold text-[#176e66]">
                  <GitCompareArrows size={12} aria-hidden="true" />
                  校订定位
                </p>
                <p className="mt-1">
                  文章《{document.title}》· 第 {activeIndex + 1} 章
                  {chapters[activeIndex]?.title ?? ""}
                </p>
                <p>
                  {chapterSuggestions.length > 0
                    ? `本章 ${chapterSuggestions.length} 处校订 · 涉及行 ${changedLineNos.join("、")}`
                    : "本章暂无校订"}
                </p>
              </div>
            ) : null}
            <button
              type="button"
              className="mt-3 flex w-full items-center justify-between text-xs text-muted-foreground"
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
