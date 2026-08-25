import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Check,
  ChevronRight,
  Coins,
  Download,
  FileArchive,
  History,
  MessageSquareText,
  Paperclip,
  RotateCcw,
  Users,
  Vote,
  X,
} from "lucide-react";
import { useState } from "react";
import { Badge, Button } from "../../components/ui";
import {
  getAttachment,
  getPoll,
  getPollVotes,
  getRevisions,
  listSuggestions,
  purchaseAttachment,
  reviewSuggestion,
  votePoll,
} from "../../lib/api";
import type { RevisionSummary, SeedIdentity } from "../../lib/types";
import { cn, formatTime } from "../../lib/utils";

/** 完整创作模式左侧的章节目录：点击切换当前编辑章节。 */
export function ChapterRail({
  chapters,
  currentIndex,
  onSelect,
  className,
}: {
  chapters: readonly { id: string; title: string }[];
  currentIndex: number;
  onSelect: (index: number) => void;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "sticky top-[76px] max-h-[calc(100vh-92px)] overflow-auto rounded-lg border border-border bg-white shadow-panel",
        className,
      )}
      aria-label="章节目录"
    >
      <div className="border-b border-border p-3.5 last:border-b-0">
        <div className="mb-[11px] flex items-center justify-between gap-2 text-[13px] font-bold">
          <span className="flex items-center gap-2">
            <BookOpen size={15} />
            章节目录
          </span>
          <Badge tone="teal">创作中</Badge>
        </div>
        <nav>
          {chapters.map((chapter, order) => {
            const [main, sub] = chapter.title.split(" · ");
            const active = order === currentIndex;
            return (
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-[9px] rounded-[5px] px-2.5 py-[9px] text-left text-[13px] text-[#4c5761] hover:bg-[#edf7f5] hover:text-[#176e66] data-[active=true]:bg-[#edf7f5] data-[active=true]:text-[#176e66]"
                data-active={active}
                key={chapter.id}
                onClick={() => onSelect(order)}
              >
                <span className="min-w-0 flex-1">
                  <strong className="block truncate font-semibold">
                    {main}
                  </strong>
                  {sub ? (
                    <small className="block truncate text-[10px] text-muted-foreground">
                      {sub}
                    </small>
                  ) : null}
                </span>
                <ChevronRight size={13} />
              </button>
            );
          })}
        </nav>
      </div>
      <div className="border-b border-border p-3.5 last:border-b-0">
        <p className="mb-2 text-xs font-semibold tracking-normal text-muted-foreground uppercase">本章统计</p>
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">字数</dt>
            <dd className="mt-1 font-bold">3,842</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">修订</dt>
            <dd className="mt-1 font-bold">18</dd>
          </div>
        </dl>
      </div>
    </aside>
  );
}

/** 读者纠错建议的待审、接受和拒绝状态演示。 */
function SuggestionPanel({
  documentId,
  baseRevision,
}: {
  documentId: string;
  baseRevision: number;
}) {
  const queryClient = useQueryClient();
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["demo", "suggestions", documentId],
    queryFn: ({ signal }) => listSuggestions(documentId, signal),
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const decide = async (id: string, decision: "approve" | "reject") => {
    setBusyId(id);
    setError("");
    try {
      await reviewSuggestion(id, decision, baseRevision);
      await queryClient.invalidateQueries({
        queryKey: ["demo", "suggestions", documentId],
      });
      // 接受会合并正文并创建新修订：刷新文档与历史。
      await queryClient.invalidateQueries({ queryKey: ["document", documentId] });
      await queryClient.invalidateQueries({ queryKey: ["revisions", documentId] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "审核失败");
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) return <p className="text-xs text-muted-foreground">加载中…</p>;
  if (items.length === 0) return <p className="text-xs text-muted-foreground">暂无待处理的校订建议</p>;

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded bg-[#fdf1f0] px-2 py-1.5 text-[11px] text-[#8f2b24]">{error}</p>
      ) : null}
      {items.map((item) => (
        <article key={item.id} className="rounded-md border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold">{item.authorId}</span>
            {item.status === "pending" ? (
              <Badge tone="amber">待审核</Badge>
            ) : (
              <Badge tone={item.status === "approved" ? "green" : "red"}>
                {item.status === "approved" ? "已合并并建版" : "已拒绝并通知"}
              </Badge>
            )}
          </div>
          <div className="space-y-1 rounded bg-muted p-2 font-mono text-[11px]">
            <p className="text-[#aa3f3f] line-through">{item.fromText}</p>
            <p className="text-[#18704b]">{item.toText}</p>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
            {item.reason}
          </p>
          {item.status === "pending" && (
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                disabled={busyId === item.id}
                onClick={() => void decide(item.id, "approve")}
              >
                <Check size={13} />
                接受
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                disabled={busyId === item.id}
                onClick={() => void decide(item.id, "reject")}
              >
                <X size={13} />
                拒绝
              </Button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

/** 附件金币购买与 70% 作者分成，数据来自服务端。 */
function AttachmentPanel({ identity }: { identity: SeedIdentity }) {
  const queryClient = useQueryClient();
  const { data: attachment, isLoading } = useQuery({
    queryKey: ["demo", "attachment", "attachment-sample"],
    queryFn: ({ signal }) => getAttachment("attachment-sample", signal),
  });
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState("");

  const buy = async () => {
    setPurchasing(true);
    setError("");
    try {
      await purchaseAttachment("attachment-sample");
      await queryClient.invalidateQueries({
        queryKey: ["demo", "attachment", "attachment-sample"],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "购买失败");
    } finally {
      setPurchasing(false);
    }
  };

  if (isLoading || !attachment)
    return <p className="text-xs text-muted-foreground">加载中…</p>;
  const purchased = attachment.purchased;
  const affordable = identity.coins >= attachment.price;

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded bg-[#fdf1f0] px-2 py-1.5 text-[11px] text-[#8f2b24]">{error}</p>
      ) : null}
      <article className="rounded-md border border-border p-3">
        <div className="flex gap-3">
          <span className="grid h-10 w-10 place-items-center rounded bg-[#edf2f3] text-[#59656f]">
            <FileArchive size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <strong className="block truncate text-xs">{attachment.name}</strong>
            <small className="text-[10px] text-muted-foreground">
              {attachment.mimeType}
            </small>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between rounded bg-[#fff8e8] px-2 py-2 text-xs">
          <span className="flex items-center gap-1 font-bold text-[#825209]">
            <Coins size={14} />
            {attachment.price} 金币
          </span>
          <span className="text-[10px] text-[#8a682b]">
            作者获得 {Math.floor(attachment.price * 0.7)}（70%）
          </span>
        </div>
        <Button
          className="mt-3 w-full"
          size="sm"
          disabled={purchased || !affordable || purchasing}
          onClick={() => void buy()}
        >
          {purchased ? (
            <>
              <Download size={14} />
              已购买，可下载
            </>
          ) : (
            <>
              <Coins size={14} />
              {affordable ? "购买附件" : "金币不足"}
            </>
          )}
        </Button>
      </article>
    </div>
  );
}

/** 投票资格、选择和实名明细，数据来自服务端。 */
function PollPanel({ pollId }: { pollId: string }) {
  const queryClient = useQueryClient();
  const { data: poll, isLoading } = useQuery({
    queryKey: ["demo", "poll", pollId],
    queryFn: ({ signal }) => getPoll(pollId, signal),
  });
  const [detail, setDetail] = useState(false);
  const [voting, setVoting] = useState(false);
  const [error, setError] = useState("");
  const [detailItems, setDetailItems] = useState<
    Array<{ user: { id: string; name: string; role: string }; optionIds: string[]; createdAt: string }>
  >([]);

  const toggleDetail = async () => {
    const next = !detail;
    setDetail(next);
    if (next && detailItems.length === 0) {
      try {
        const result = await getPollVotes(pollId);
        setDetailItems(result.items);
      } catch {
        setDetailItems([]);
      }
    }
  };

  const choose = async (optionId: string) => {
    if (!poll || voting) return;
    setVoting(true);
    setError("");
    try {
      await votePoll(pollId, [optionId]);
      await queryClient.invalidateQueries({ queryKey: ["demo", "poll", pollId] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "投票失败");
    } finally {
      setVoting(false);
    }
  };

  if (isLoading || !poll)
    return <p className="text-xs text-muted-foreground">加载中…</p>;
  const total = poll.options.reduce((sum, item) => sum + item.votes, 0) || 1;

  return (
    <div>
      <h3 className="text-sm font-bold">{poll.question}</h3>
      <p className="mt-1 text-[11px] text-muted-foreground">
        注册满 7 天且发布过 1 条回复可投票
      </p>
      {error ? (
        <p className="mt-2 rounded bg-[#fdf1f0] px-2 py-1.5 text-[11px] text-[#8f2b24]">{error}</p>
      ) : null}
      <div className="mt-3 space-y-2">
        {poll.options.map((option) => {
          const selected = poll.viewerOptionIds.includes(option.id);
          const width = `${Math.round((option.votes / total) * 100)}%`;
          return (
            <button
              type="button"
              key={option.id}
              className="relative block h-10 w-full overflow-hidden rounded-md border border-border bg-white text-left"
              onClick={() => void choose(option.id)}
            >
              <span
                className="absolute inset-y-0 left-0 bg-[#e5f4f1]"
                style={{ width }}
              />
              <span className="relative flex items-center justify-between px-3 text-xs">
                <span className="font-semibold">{option.label}</span>
                <span>
                  {option.votes} 票{selected ? " · 已选" : ""}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="mt-2 w-full"
        onClick={() => void toggleDetail()}
      >
        <Users size={14} />
        {detail ? "收起实名明细" : "查看实名投票明细"}
      </Button>
      {detail && (
        <div className="mt-2 rounded bg-muted p-2 text-[11px] leading-6 text-muted-foreground">
          {detailItems.length === 0 ? (
            <p>暂无实名投票记录</p>
          ) : (
            detailItems.map((item) => (
              <p key={`${item.user.id}-${item.createdAt}`}>
                {item.user.name} →{" "}
                {poll.options
                  .filter((option) => item.optionIds.includes(option.id))
                  .map((option) => option.label)
                  .join("、")}
              </p>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** 展示不可变 revision 摘要并请求回滚目标版本。 */
export function HistoryPanel({
  revisions,
  onRestore,
}: {
  revisions: RevisionSummary[];
  onRestore: (revision: number) => void;
}) {
  return (
    <div className="space-y-2">
      {revisions.map((item) => (
        <article
          key={item.revision}
          className="rounded-md border border-border p-2.5"
        >
          <div className="flex items-center justify-between">
            <strong className="text-xs">版本 {item.revision}</strong>
            <time className="text-[10px] text-muted-foreground">
              {formatTime(item.savedAt)}
            </time>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            {item.authorName} · {item.summary}
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="ghost" size="sm" className="h-7 px-2">
              比较
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => onRestore(item.revision)}
            >
              <RotateCcw size={12} />
              回退
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}

/** 汇总首版 mock 业务面板；所有标签都对接演示 API。 */
export function DemoBusinessPanel({
  identity,
  documentId,
  baseRevision,
  onRestore,
}: {
  identity: SeedIdentity;
  documentId: string;
  /** 当前文档 revision，作为审核建议合并的基线。 */
  baseRevision: number;
  onRestore: (revision: number) => void;
}) {
  const [tab, setTab] = useState<
    "suggestions" | "attachment" | "poll" | "history"
  >("suggestions");
  const { data: revisions = [] } = useQuery({
    queryKey: ["revisions", documentId],
    queryFn: ({ signal }) => getRevisions(documentId, signal),
  });
  const tabs = [
    { id: "suggestions" as const, label: "校订", icon: MessageSquareText },
    { id: "attachment" as const, label: "附件", icon: Paperclip },
    { id: "poll" as const, label: "投票", icon: Vote },
    { id: "history" as const, label: "历史", icon: History },
  ];
  return (
    <aside className="sticky top-[76px] max-h-[calc(100vh-92px)] overflow-auto rounded-lg border border-border bg-white shadow-panel" aria-label="创作业务面板">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <strong className="text-sm">创作工具</strong>
        <span className="inline-flex h-5 items-center rounded border border-[#d3a859] bg-[#fff9ed] px-1.5 text-[10px] font-bold whitespace-nowrap text-[#80530a]">演示数据</span>
      </div>
      <div className="grid grid-cols-4 border-b border-border">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            onClick={() => setTab(id)}
            data-active={tab === id}
            className="grid min-h-12 place-items-center gap-0.5 border-b-2 border-transparent text-[10px] text-muted-foreground data-[active=true]:border-primary data-[active=true]:text-primary"
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      <div className="p-3">
        {tab === "suggestions" && (
          <SuggestionPanel documentId={documentId} baseRevision={baseRevision} />
        )}
        {tab === "attachment" && <AttachmentPanel identity={identity} />}
        {tab === "poll" && <PollPanel pollId="poll-route" />}
        {tab === "history" && (
          <HistoryPanel revisions={revisions} onRestore={onRestore} />
        )}
      </div>
    </aside>
  );
}
