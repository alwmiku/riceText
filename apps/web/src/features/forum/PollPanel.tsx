import { Users } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui";
import { usePoll } from "./usePoll";

/** 投票资格、选择和实名明细，数据来自服务端。 */
export function PollPanel({ pollId }: { pollId: string }) {
  const [detail, setDetail] = useState(false);
  const { poll, isLoading, error, detailItems, choose, loadDetail } =
    usePoll(pollId);

  const toggleDetail = async () => {
    const next = !detail;
    setDetail(next);
    if (next) await loadDetail();
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
        <p className="mt-2 rounded bg-[#fdf1f0] px-2 py-1.5 text-[11px] text-[#8f2b24]">
          {error}
        </p>
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
