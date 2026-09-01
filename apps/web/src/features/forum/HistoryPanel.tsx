import { GitCompareArrows, RotateCcw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import type { RevisionSummary } from "../../lib/types";
import { formatTime } from "../../lib/utils";

/** 展示不可变历史版本摘要，并提供正文比较与二次确认回退操作。 */
export function HistoryPanel({
  revisions,
  comparingRevision,
  onCompare,
  onRestore,
}: {
  revisions: RevisionSummary[];
  comparingRevision?: number | null;
  onCompare?: (revision: number) => void;
  onRestore: (revision: number) => void;
}) {
  const [pendingRestore, setPendingRestore] = useState<number | null>(null);
  return (
    <>
      <div className="flex flex-col gap-2">
        {revisions.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
            暂无历史记录，保存当前章节后会自动生成
          </p>
        ) : null}
        {revisions.map((item) => (
          <article key={item.revision} className="rounded-md border border-border p-2.5">
            <div className="flex items-center justify-between">
              <strong className="text-xs">版本 {item.revision}</strong>
              <time className="text-[10px] text-muted-foreground">{formatTime(item.savedAt)}</time>
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
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                disabled={!onCompare || comparingRevision != null}
                onClick={() => onCompare?.(item.revision)}
              >
                <GitCompareArrows size={12} />
                {comparingRevision === item.revision ? "加载中" : "比较"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => setPendingRestore(item.revision)}
              >
                <RotateCcw size={12} />
                回退
              </Button>
            </div>
          </article>
        ))}
      </div>

      <AlertDialog open={pendingRestore !== null} onOpenChange={(open) => !open && setPendingRestore(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <TriangleAlert />
            </AlertDialogMedia>
            <AlertDialogTitle>确认回退版本</AlertDialogTitle>
            <AlertDialogDescription>
              将以版本 {pendingRestore ?? ""} 的正文创建一个新版本。现有历史不会删除，但当前未保存内容会被替换。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingRestore !== null) onRestore(pendingRestore);
                setPendingRestore(null);
              }}
            >
              确认回退
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
