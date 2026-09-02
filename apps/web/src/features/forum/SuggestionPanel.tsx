import { Check, MapPin, X } from "lucide-react";
import { useState } from "react";
import { Badge, Button } from "../../components/ui";
import { SuggestionBatchCard } from "../proofread/SuggestionBatchCard";
import { formatSuggestionAuthor } from "../proofread/suggestion-labels";
import { cn } from "../../lib/utils";
import { useSuggestions } from "./useSuggestions";

/** 读者纠错建议的待审、接受和拒绝状态展示。 */
export function SuggestionPanel({
  documentId,
  baseRevision,
  chapterId,
  chapterTitle,
}: {
  documentId: string;
  baseRevision: number;
  chapterId: string;
  chapterTitle: string;
}) {
  const { items, batches, isLoading, busyId, error, decide, decideBatch } =
    useSuggestions(documentId, baseRevision);
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">(
    "pending",
  );
  const chapterItems = items.filter(
    (item) => item.chapterId === chapterId && item.status === status,
  );
  const chapterBatches = batches.filter(
    (item) => item.chapterId === chapterId && item.status === status,
  );
  const counts = {
    pending:
      items.filter(
        (item) => item.chapterId === chapterId && item.status === "pending",
      ).length +
      batches.filter(
        (item) => item.chapterId === chapterId && item.status === "pending",
      ).length,
    approved:
      items.filter(
        (item) => item.chapterId === chapterId && item.status === "approved",
      ).length +
      batches.filter(
        (item) => item.chapterId === chapterId && item.status === "approved",
      ).length,
    rejected:
      items.filter(
        (item) => item.chapterId === chapterId && item.status === "rejected",
      ).length +
      batches.filter(
        (item) => item.chapterId === chapterId && item.status === "rejected",
      ).length,
  };

  if (isLoading)
    return <p className="text-xs text-muted-foreground">加载中…</p>;

  return (
    <div className="space-y-3">
      <div
        className="grid grid-cols-3 border-b border-border"
        role="tablist"
        aria-label="校订状态"
      >
        {([
          ["pending", "待审核"],
          ["approved", "已接受"],
          ["rejected", "已拒绝"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={status === id}
            onClick={() => setStatus(id)}
            className={cn(
              "flex min-h-9 items-center justify-center gap-1 border-b-2 border-transparent px-1 text-[11px] font-semibold text-muted-foreground",
              status === id && "border-primary text-primary",
            )}
          >
            {label}
            <span className="rounded bg-muted px-1 py-px text-[9px]">
              {counts[id]}
            </span>
          </button>
        ))}
      </div>
      {error ? (
        <p className="rounded bg-[#fdf1f0] px-2 py-1.5 text-[11px] text-[#8f2b24]">
          {error}
        </p>
      ) : null}
      {chapterItems.length === 0 && chapterBatches.length === 0 ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{chapterTitle}</p>
          <p>
            {status === "pending"
              ? "本章暂无待处理的校订建议"
              : status === "approved"
                ? "本章暂无已接受的校订"
                : "本章暂无已拒绝的校订"}
          </p>
        </div>
      ) : null}
      {chapterBatches.map((batch) => (
        <SuggestionBatchCard
          key={batch.id}
          batch={batch}
          busy={busyId !== null}
          onReview={(decision) => void decideBatch(batch.id, decision)}
        />
      ))}
      {chapterItems.map((item) => (
        <article key={item.id} className="rounded-md border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold">
              {formatSuggestionAuthor(item.authorId)}
            </span>
            {item.status === "pending" ? (
              <Badge tone="amber">待审核</Badge>
            ) : (
              <Badge tone={item.status === "approved" ? "green" : "red"}>
                {item.status === "approved" ? "已合并并建版" : "已拒绝并通知"}
              </Badge>
            )}
          </div>
          {item.chapterTitle || item.lineNo > 0 ? (
            <div
              className="mb-2 flex items-start gap-2 text-[11px] leading-4 text-muted-foreground"
              aria-label="校订位置"
            >
              <MapPin size={11} className="mt-0.5 shrink-0 text-[#176e66]" />
              <dl className="flex min-w-0 flex-1 flex-col gap-0.5">
                {item.chapterTitle ? (
                  <div>
                    <dt className="sr-only">章节</dt>
                    <dd className="font-semibold break-words text-[#176e66]">
                      {item.chapterTitle}
                    </dd>
                  </div>
                ) : null}
                {item.lineNo > 0 ? (
                  <div>
                    <dt className="sr-only">行号</dt>
                    <dd>第 {item.lineNo} 行</dd>
                  </div>
                ) : null}
                {item.lineText ? (
                  <div>
                    <dt className="sr-only">原文</dt>
                    <dd className="break-words">「{item.lineText}」</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          ) : null}
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
