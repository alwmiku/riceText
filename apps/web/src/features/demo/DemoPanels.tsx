import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  Check,
  ChevronRight,
  Coins,
  Download,
  FileArchive,
  FileText,
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
import { getRevisions } from "../../lib/api";
import type { RevisionSummary, SeedIdentity } from "../../lib/types";
import { formatTime } from "../../lib/utils";

/** 完整创作模式左侧的章节目录：点击切换当前编辑章节。 */
export function ChapterRail({
  chapters,
  currentIndex,
  onSelect,
}: {
  chapters: readonly { id: string; title: string }[];
  currentIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <aside className="workspace-rail surface" aria-label="章节目录">
      <div className="side-section">
        <div className="side-heading">
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
                className="chapter-item"
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
      <div className="side-section">
        <p className="section-label mb-2">本章统计</p>
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
function SuggestionPanel() {
  const [items, setItems] = useState([
    {
      id: "s1",
      user: "晚风翻页",
      from: "渡口的汽笛",
      to: "港口的汽笛",
      reason: "与第一章地名保持一致",
      status: "pending",
    },
    {
      id: "s2",
      user: "纸页留声",
      from: "她握紧信封",
      to: "她攥紧信封",
      reason: "减少相邻段落用词重复",
      status: "pending",
    },
  ]);
  const decide = (id: string, status: "accepted" | "rejected") =>
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, status } : item)),
    );
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <article key={item.id} className="rounded-md border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold">{item.user}</span>
            {item.status === "pending" ? (
              <Badge tone="amber">待审核</Badge>
            ) : (
              <Badge tone={item.status === "accepted" ? "green" : "red"}>
                {item.status === "accepted" ? "已合并并建版" : "已拒绝并通知"}
              </Badge>
            )}
          </div>
          <div className="space-y-1 rounded bg-muted p-2 font-mono text-[11px]">
            <p className="text-[#aa3f3f] line-through">{item.from}</p>
            <p className="text-[#18704b]">{item.to}</p>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
            {item.reason}
          </p>
          {item.status === "pending" && (
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={() => decide(item.id, "accepted")}
              >
                <Check size={13} />
                接受
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => decide(item.id, "rejected")}
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

/** 附件金币购买与 70% 作者分成的前端演示状态。 */
function AttachmentPanel({ identity }: { identity: SeedIdentity }) {
  const [purchased, setPurchased] = useState(false);
  return (
    <div className="space-y-3">
      <article className="rounded-md border border-border p-3">
        <div className="flex gap-3">
          <span className="grid h-10 w-10 place-items-center rounded bg-[#edf2f3] text-[#59656f]">
            <FileArchive size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <strong className="block truncate text-xs">
              雾港设定资料集.zip
            </strong>
            <small className="text-[10px] text-muted-foreground">
              2.7 MB · ZIP
            </small>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between rounded bg-[#fff8e8] px-2 py-2 text-xs">
          <span className="flex items-center gap-1 font-bold text-[#825209]">
            <Coins size={14} />
            20 金币
          </span>
          <span className="text-[10px] text-[#8a682b]">作者获得 14（70%）</span>
        </div>
        <Button
          className="mt-3 w-full"
          size="sm"
          disabled={purchased || identity.coins < 20}
          onClick={() => setPurchased(true)}
        >
          {purchased ? (
            <>
              <Download size={14} />
              已购买，可下载
            </>
          ) : (
            <>
              <Coins size={14} />
              购买附件
            </>
          )}
        </Button>
      </article>
      <article className="flex items-center gap-3 rounded-md border border-border p-3">
        <FileText size={18} className="text-primary" />
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-xs">时间线勘误.txt</strong>
          <small className="text-[10px] text-muted-foreground">
            12 KB · 免费
          </small>
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label="下载时间线勘误"
        >
          <Download size={15} />
        </Button>
      </article>
    </div>
  );
}

/** 投票资格、选择和实名明细的前端演示状态。 */
function PollPanel({ identity }: { identity: SeedIdentity }) {
  const [choice, setChoice] = useState(
    identity.role === "author" ? "灯塔守望人" : "",
  );
  const [detail, setDetail] = useState(false);
  const options = [
    { name: "灯塔守望人", votes: 28 },
    { name: "失踪的邮差", votes: 19 },
    { name: "港务局记录员", votes: 11 },
  ];
  const total =
    options.reduce((sum, item) => sum + item.votes, 0) +
    (choice && identity.role !== "author" ? 1 : 0);
  return (
    <div>
      <h3 className="text-sm font-bold">下一章先跟随哪位角色？</h3>
      <p className="mt-1 text-[11px] text-muted-foreground">
        注册满 7 天且发布过 1 条回复可投票
      </p>
      <div className="mt-3 space-y-2">
        {options.map((option) => {
          const votes =
            option.votes +
            (choice === option.name && identity.role !== "author" ? 1 : 0);
          return (
            <button
              type="button"
              key={option.name}
              className="relative block h-10 w-full overflow-hidden rounded-md border border-border bg-white text-left"
              onClick={() => setChoice(option.name)}
            >
              <span
                className="absolute inset-y-0 left-0 bg-[#e5f4f1]"
                style={{ width: `${(votes / total) * 100}%` }}
              />
              <span className="relative flex items-center justify-between px-3 text-xs">
                <span className="font-semibold">{option.name}</span>
                <span>{votes} 票</span>
              </span>
            </button>
          );
        })}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="mt-2 w-full"
        onClick={() => setDetail((current) => !current)}
      >
        <Users size={14} />
        {detail ? "收起实名明细" : "查看实名投票明细"}
      </Button>
      {detail && (
        <div className="mt-2 rounded bg-muted p-2 text-[11px] leading-6 text-muted-foreground">
          <p>晚风翻页 → 灯塔守望人</p>
          <p>纸页留声 → 失踪的邮差</p>
          <p>版务小禾 → 港务局记录员</p>
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

/** 汇总首版 mock 业务面板；所有标签都明确标示为演示数据。 */
export function DemoBusinessPanel({
  identity,
  documentId,
  onRestore,
}: {
  identity: SeedIdentity;
  documentId: string;
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
    <aside className="workspace-rail surface" aria-label="创作业务面板">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <strong className="text-sm">创作工具</strong>
        <span className="demo-label">演示数据</span>
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
        {tab === "suggestions" && <SuggestionPanel />}
        {tab === "attachment" && <AttachmentPanel identity={identity} />}
        {tab === "poll" && <PollPanel identity={identity} />}
        {tab === "history" && (
          <HistoryPanel revisions={revisions} onRestore={onRestore} />
        )}
      </div>
    </aside>
  );
}
