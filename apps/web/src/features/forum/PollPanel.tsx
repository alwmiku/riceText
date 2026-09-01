import { Check, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui";
import { cn } from "../../lib/utils";
import { usePoll } from "./usePoll";

/** 投票资格、选择和实名明细，数据来自服务端。 */
export function PollPanel({ pollId }: { pollId: string }) {
  const [detail, setDetail] = useState(false);
  const { poll, isLoading, error, detailItems, isVoting, choose, loadDetail } =
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
              aria-pressed={selected}
              data-state={selected ? "selected" : "idle"}
              disabled={isVoting}
              className={cn(
                "relative block h-11 w-full overflow-hidden rounded-md border bg-background text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "disabled:cursor-wait disabled:opacity-70",
                selected
                  ? "border-primary bg-secondary ring-1 ring-primary/30"
                  : "border-border hover:border-primary/50 hover:bg-muted/40",
              )}
              onClick={() => void choose(option.id)}
            >
              <span
                className={cn(
                  "absolute inset-y-0 left-0 transition-colors",
                  selected ? "bg-primary/15" : "bg-secondary",
                )}
                style={{ width }}
              />
              <span className="relative flex h-full items-center justify-between gap-3 px-3 text-xs">
                <span className="flex min-w-0 items-center gap-2 font-semibold">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "inline-flex size-4 shrink-0 items-center justify-center rounded-full border",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/40 bg-background",
                    )}
                  >
                    {selected ? <Check size={11} strokeWidth={3} /> : null}
                  </span>
                  <span className="truncate">{option.label}</span>
                </span>
                <span className={cn("shrink-0", selected && "font-semibold text-primary")}>
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
