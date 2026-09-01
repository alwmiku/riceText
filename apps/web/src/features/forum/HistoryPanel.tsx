import { RotateCcw } from "lucide-react";
import { Button } from "../../components/ui";
import type { RevisionSummary } from "../../lib/types";
import { formatTime } from "../../lib/utils";

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
          {item.stepsSummary ? (
            <p className="mt-1 rounded bg-muted px-1.5 py-1 text-[10px] leading-4 text-muted-foreground">
              本次改动：{item.stepsSummary}
            </p>
          ) : null}
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
