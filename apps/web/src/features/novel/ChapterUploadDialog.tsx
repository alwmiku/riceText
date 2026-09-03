import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  LoaderCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button, Dialog } from "../../components/ui";
import {
  Marker,
  MarkerContent,
  MarkerIcon,
} from "../../components/ui/marker";
import { Progress } from "../../components/ui/progress";
import { ScrollArea } from "../../components/ui/scroll-area";
import { TextMarquee } from "../../components/ui/text-marquee";
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

/** prepare 阶段生成并在每批上传后更新的差异与进度摘要。 */
export interface ChapterUploadDiff {
  total: number;
  toUpdate: number;
  added: number;
  modified: number;
  uploaded: number;
  /** 失败（含不可重试冲突）章节数。 */
  failed: number;
  /** 待上传（含上传中）章节数。 */
  pending: number;
  gaps: number;
  stale: boolean;
  /** 当前正在发送的第几批（1-based），未在上传时为 null。 */
  batchCurrent: number | null;
  /** 当前运行的预计批次数，未在上传时为 null。 */
  batchTotal: number | null;
  rows: ChapterUploadRow[];
}

const ROW_HEIGHT = 64;
const OVERSCAN_ROWS = 8;
/** 对话框正文最大高度：随视口留边，保证底部按钮始终可见。 */
const DIALOG_BODY_MAX_HEIGHT = "min(72dvh, 640px)";

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

function ChapterListRow({
  row,
  index,
  style,
}: {
  row: ChapterUploadRow;
  index: number;
  style: CSSProperties;
}) {
  return (
    <div
      style={style}
      className="flex min-w-0 items-center gap-3 border-b px-1.5 py-1.5 text-xs last:border-b-0"
    >
      <div className="min-w-0 flex-1">
        <TextMarquee
          text={(index + 1) + ". " + row.title}
          className="text-xs font-medium"
        />
        <p className="truncate text-muted-foreground">
          {row.action}
          {row.attempts > 0 ? " · 已尝试 " + row.attempts + " 次" : ""}
        </p>
        {row.error ? (
          <p className="truncate text-destructive" title={row.error}>
            {row.error}
          </p>
        ) : null}
      </div>
      <StatusMarker row={row} />
    </div>
  );
}

/**
 * 固定在 ScrollArea（shadcn，自定义滚动条）内的轻量虚拟列表：
 * 只挂载可见行 ± 过扫区，其余用绝对定位占位保持总滚动范围，
 * 几千章时列表跳转、缩放和上传进度更新都不再重绘全部行。
 */
function VirtualChapterList({ rows }: { rows: readonly ChapterUploadRow[] }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [range, setRange] = useState({ start: 0, end: 0 });

  const syncRange = useCallback(() => {
    const viewport = rootRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (!viewport) return;
    const start = Math.max(
      0,
      Math.floor(viewport.scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS,
    );
    const end = Math.min(
      rows.length,
      Math.ceil((viewport.scrollTop + viewport.clientHeight) / ROW_HEIGHT) +
        OVERSCAN_ROWS,
    );
    setRange((previous) =>
      previous.start === start && previous.end === end ? previous : { start, end },
    );
  }, [rows.length]);

  useEffect(() => {
    const viewport = rootRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (!viewport) return;
    const observer = new ResizeObserver(syncRange);
    observer.observe(viewport);
    viewport.addEventListener("scroll", syncRange, { passive: true });
    syncRange();
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", syncRange);
    };
  }, [syncRange]);

  if (rows.length === 0) {
    return (
      <p className="px-3 py-4 text-xs text-muted-foreground">
        当前筛选下没有章节。
      </p>
    );
  }

  return (
    <ScrollArea
      ref={rootRef}
      type="auto"
      className="min-h-0 flex-1 [&_[data-slot=scroll-area-thumb]]:rounded-full [&_[data-slot=scroll-area-thumb]]:bg-muted-foreground/45 [&_[data-slot=scroll-area-thumb]]:hover:bg-muted-foreground/65 [&_[data-slot=scroll-area-thumb]]:transition-colors"
    >
      <div
        className="relative w-full"
        style={{ height: rows.length * ROW_HEIGHT }}
      >
        {rows.slice(range.start, range.end).map((row, offset) => {
          const index = range.start + offset;
          return (
            <ChapterListRow
              key={row.id || String(index)}
              row={row}
              index={index}
              style={{
                position: "absolute",
                top: index * ROW_HEIGHT,
                left: 0,
                right: 0,
                height: ROW_HEIGHT,
              }}
            />
          );
        })}
      </div>
    </ScrollArea>
  );
}

/** 展示冻结上传计划、总进度、批次进度和每章可续传状态（仅挂载可见行）。 */
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
  const [filter, setFilter] = useState<"all" | "failed">("all");
  const progress = diff?.toUpdate
    ? Math.round((diff.uploaded / diff.toUpdate) * 100)
    : 100;
  const hasFailed =
    diff?.rows.some((row) => row.status === "失败" && row.retryable !== false) ??
    false;
  const hasBlockingConflict =
    diff?.rows.some((row) => row.status === "失败" && row.retryable === false) ??
    false;
  const complete = Boolean(
    diff && diff.toUpdate > 0 && diff.uploaded === diff.toUpdate,
  );
  const failedRows = useMemo(
    () => diff?.rows.filter((row) => row.status === "失败") ?? [],
    [diff],
  );
  const visibleRows = filter === "failed" ? failedRows : (diff?.rows ?? []);
  const inBatch = uploading && diff?.batchCurrent != null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="确定并分章上传"
      description="章节按 20 章一批顺序上传；中断后会从当前批次继续。"
      className="max-w-2xl"
    >
      {diff ? (
        <div
          className="flex flex-col gap-3 overflow-hidden"
          style={{ maxHeight: DIALOG_BODY_MAX_HEIGHT }}
        >
          {diff.gaps > 0 ? (
            <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              本地核对发现仍有 <strong>{diff.gaps}</strong>{" "}
              段文字未切分进任何章节，建议先核对并处理再上传。
            </div>
          ) : (
            <div className="shrink-0 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
              本地核对通过：全部原文已连续切分进章节，无未切分段落。
            </div>
          )}
          {diff.stale ? (
            <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              准备上传后正文又有修改，当前计划已过期，请重新检查差异。
            </div>
          ) : null}
          <p className="shrink-0 text-xs text-muted-foreground">
            本地共 <strong>{diff.total}</strong> 个章节，本次上传{" "}
            <strong>{diff.toUpdate}</strong> 个（新增 {diff.added}，修改{" "}
            {diff.modified}）。未变化的章节不会重复上传。
          </p>
          <div className="shrink-0 flex flex-col gap-1" aria-live="polite">
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
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-3 text-muted-foreground">
              <span>成功 {diff.uploaded}</span>
              <span>失败 {diff.failed}</span>
              <span>待上传 {diff.pending}</span>
            </div>
            {inBatch ? (
              <span aria-live="polite">
                分批上传：第 {diff.batchCurrent} / {diff.batchTotal} 批
              </span>
            ) : null}
          </div>
          <div className="flex min-h-[96px] min-w-0 flex-1 flex-col overflow-hidden rounded-md border">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-2 py-1.5">
              <div className="flex gap-1" role="tablist" aria-label="章节筛选">
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === "all"}
                  onClick={() => setFilter("all")}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs",
                    filter === "all"
                      ? "bg-foreground/10 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-foreground/5",
                  )}
                >
                  全部（{diff.rows.length}）
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === "failed"}
                  onClick={() => setFilter("failed")}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs",
                    filter === "failed"
                      ? "bg-foreground/10 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-foreground/5",
                  )}
                >
                  仅失败（{failedRows.length}）
                </button>
              </div>
              <span className="text-muted-foreground">
                {visibleRows.length} 行可见
              </span>
            </div>
            <VirtualChapterList rows={visibleRows} />
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t pt-2.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {complete
                ? "关闭"
                : uploading
                  ? "当前批次完成后暂停"
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
