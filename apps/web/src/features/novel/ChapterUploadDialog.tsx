import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  LoaderCircle,
} from "lucide-react";
import { Button, Dialog } from "../../components/ui";
import {
  Marker,
  MarkerContent,
  MarkerIcon,
} from "../../components/ui/marker";
import { Progress } from "../../components/ui/progress";
import { cn } from "../../lib/utils";

export type ChapterUploadAction = "新增" | "修改" | "未变化";
export type ChapterUploadStatus =
  | "待上传"
  | "上传中"
  | "已上传"
  | "未变化"
  | "失败";

export interface ChapterUploadRow {
  id: string;
  title: string;
  action: ChapterUploadAction;
  status: ChapterUploadStatus;
  attempts: number;
  error?: string;
  retryable?: boolean;
}

/** prepare 阶段生成并在每章上传后更新的差异与进度摘要。 */
export interface ChapterUploadDiff {
  total: number;
  toUpdate: number;
  added: number;
  modified: number;
  uploaded: number;
  gaps: number;
  stale: boolean;
  rows: ChapterUploadRow[];
}

function StatusMarker({ row }: { row: ChapterUploadRow }) {
  const icon =
    row.status === "已上传" || row.status === "未变化" ? (
      <CheckCircle2 />
    ) : row.status === "上传中" ? (
      <LoaderCircle className="animate-spin" />
    ) : row.status === "失败" ? (
      <AlertCircle />
    ) : (
      <CircleDashed />
    );
  return (
    <Marker
      className={cn(
        "w-auto shrink-0 normal-case tracking-normal",
        row.status === "失败" && "text-destructive",
        row.status === "上传中" && "text-primary",
        (row.status === "已上传" || row.status === "未变化") &&
          "text-foreground",
      )}
    >
      <MarkerIcon>{icon}</MarkerIcon>
      <MarkerContent>{row.status}</MarkerContent>
    </Marker>
  );
}

/** 展示冻结上传计划、总进度和每章可续传状态。 */
export function ChapterUploadDialog({
  open,
  diff,
  uploading,
  onOpenChange,
  onConfirm,
  onReprepare,
}: {
  open: boolean;
  diff: ChapterUploadDiff | null;
  uploading: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onReprepare: () => void;
}) {
  const progress = diff?.toUpdate
    ? Math.round((diff.uploaded / diff.toUpdate) * 100)
    : 100;
  const hasFailed =
    diff?.rows.some((row) => row.status === "失败" && row.retryable !== false) ??
    false;
  const hasBlockingConflict =
    diff?.rows.some((row) => row.status === "失败" && row.retryable === false) ??
    false;
  const complete = Boolean(diff && diff.toUpdate > 0 && diff.uploaded === diff.toUpdate);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="确定并分章上传"
      description="章节按顺序独立上传；中断后会从未完成章节继续。"
      className="max-w-2xl"
    >
      {diff ? (
        <div className="flex flex-col gap-3">
          {diff.gaps > 0 ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              本地核对发现仍有 <strong>{diff.gaps}</strong>{" "}
              段文字未切分进任何章节，建议先核对并处理再上传。
            </div>
          ) : (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
              本地核对通过：全部原文已连续切分进章节，无未切分段落。
            </div>
          )}
          {diff.stale ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              准备上传后正文又有修改，当前计划已过期，请重新检查差异。
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            本地共 <strong>{diff.total}</strong> 个章节，本次上传{" "}
            <strong>{diff.toUpdate}</strong> 个（新增 {diff.added}，修改{" "}
            {diff.modified}）。未变化的章节不会重复上传。
          </p>
          <div className="flex flex-col gap-1" aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-foreground">总上传进度</span>
              <span className="text-muted-foreground">
                {diff.uploaded} / {diff.toUpdate}（{progress}%）
              </span>
            </div>
            <Progress
              value={progress}
              aria-valuenow={progress}
              aria-label="长文本上传总进度"
            />
          </div>
          <div className="max-h-72 overflow-auto rounded-md border p-2">
            {diff.rows.map((row, index) => (
              <div
                key={row.id || index}
                className="flex min-h-10 items-center justify-between gap-3 border-b py-1.5 text-xs last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {index + 1}. {row.title}
                  </p>
                  <p className="text-muted-foreground">
                    {row.action}
                    {row.attempts > 0 ? " · 已尝试 " + row.attempts + " 次" : ""}
                  </p>
                  {row.error ? (
                    <p className="mt-0.5 text-destructive">{row.error}</p>
                  ) : null}
                </div>
                <StatusMarker row={row} />
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {complete
                ? "关闭"
                : uploading
                  ? "本章完成后暂停"
                  : "稍后继续"}
            </Button>
            {!complete ? (
              diff.stale || hasBlockingConflict ? (
                <Button size="sm" disabled={uploading} onClick={onReprepare}>
                  重新检查差异
                </Button>
              ) : (
                <Button size="sm" disabled={uploading} onClick={onConfirm}>
                  {uploading ? "上传中…" : hasFailed ? "继续上传" : "确认分章上传"}
                </Button>
              )
            ) : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
