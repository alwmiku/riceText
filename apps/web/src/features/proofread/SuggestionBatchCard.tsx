import type { JSONContent } from "@ricetext/editor-core";
import { Check, Layers3, X } from "lucide-react";
import { useMemo } from "react";
import { Button, Badge } from "../../components/ui";
import { chapterTextLines } from "../../lib/chapters";
import type { ForumSuggestionBatch } from "../../lib/types";
import { formatSuggestionAuthor } from "./suggestion-labels";

/** 作者审核整章批次时使用的多行差异卡片。 */
export function SuggestionBatchCard({
  batch,
  busy,
  onReview,
}: {
  batch: ForumSuggestionBatch;
  busy: boolean;
  onReview: (decision: "approve" | "reject") => void;
}) {
  const changes = useMemo(() => {
    const before = chapterTextLines(
      (batch.beforeContent.content ?? []) as unknown as JSONContent[],
    );
    const after = chapterTextLines(
      (batch.afterContent.content ?? []) as unknown as JSONContent[],
    );
    const count = Math.max(before.length, after.length);
    return Array.from({ length: count }, (_, index) => ({
      lineNo: index + 1,
      before: before[index] ?? "",
      after: after[index] ?? "",
    })).filter((item) => item.before !== item.after);
  }, [batch]);

  return (
    <article className="rounded-md border border-border bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Layers3 size={14} className="text-[#176e66]" />
        <strong className="text-xs">
          {formatSuggestionAuthor(batch.authorId)} · 整章修订
        </strong>
        <Badge
          tone={
            batch.status === "approved"
              ? "green"
              : batch.status === "rejected"
                ? "red"
                : "amber"
          }
        >
          {batch.status === "approved"
            ? "已接受"
            : batch.status === "rejected"
              ? "已拒绝"
              : "待审核"}
        </Badge>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {changes.length} 处行级变化 · {batch.steps.length} 个步骤
        </span>
      </div>
      {batch.reason ? (
        <p className="mt-2 text-[11px] text-muted-foreground">{batch.reason}</p>
      ) : null}
      <div className="mt-3 max-h-72 space-y-2 overflow-auto">
        {changes.map((change) => (
          <div key={change.lineNo} className="overflow-hidden rounded border border-border">
            <p className="bg-[#fef3f3] px-2 py-1.5 font-mono text-[11px] break-all text-[#8f2b24]">
              <span className="mr-2 text-[#a3adb6]">-{change.lineNo}</span>
              {change.before || "（删除整行）"}
            </p>
            <p className="border-t border-[#dcebe2] bg-[#f2fbf6] px-2 py-1.5 font-mono text-[11px] break-all text-[#176e66]">
              <span className="mr-2 text-[#a3adb6]">+{change.lineNo}</span>
              {change.after || "（删除整行）"}
            </p>
          </div>
        ))}
      </div>
      {batch.status === "pending" ? (
        <div className="mt-3 flex gap-2">
          <Button className="flex-1" size="sm" disabled={busy} onClick={() => onReview("approve")}>
            <Check size={13} />
            接受全部修改
          </Button>
          <Button className="flex-1" size="sm" variant="outline" disabled={busy} onClick={() => onReview("reject")}>
            <X size={13} />
            拒绝整批
          </Button>
        </div>
      ) : null}
    </article>
  );
}
