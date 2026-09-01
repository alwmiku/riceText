import { GitCompareArrows, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../components/ui";
import { cn } from "../../lib/utils";
import { diffChars, type CharDiffOp } from "../proofread/char-diff";

export interface TextComparisonRow {
  key: string;
  beforeLineNo: number | null;
  afterLineNo: number | null;
  before: string;
  after: string;
  ops: CharDiffOp[] | null;
}

/** 将两份文本快照转换为不依赖具体业务的行级与字级比较结果。 */
export function compareTextLines(
  beforeLines: readonly string[],
  afterLines: readonly string[],
): TextComparisonRow[] {
  const length = Math.max(beforeLines.length, afterLines.length);
  return Array.from({ length }, (_, index) => {
    const before = beforeLines[index] ?? "";
    const after = afterLines[index] ?? "";
    return {
      key: [index, before, after].join(":"),
      beforeLineNo: index < beforeLines.length ? index + 1 : null,
      afterLineNo: index < afterLines.length ? index + 1 : null,
      before,
      after,
      ops: before === after ? null : diffChars(before, after),
    };
  });
}

function DiffText({ ops, side }: { ops: readonly CharDiffOp[]; side: "before" | "after" }) {
  return (
    <>
      {ops
        .filter((op) => (side === "before" ? op.type !== "insert" : op.type !== "delete"))
        .map((op, index) =>
          op.type === "equal" ? (
            <span key={index}>{op.text}</span>
          ) : op.type === "delete" ? (
            <span key={index} data-diff="delete" className="rounded-[3px] bg-[#fbdada] font-semibold text-[#b4232c] line-through decoration-[#d9828a]">
              {op.text}
            </span>
          ) : (
            <span key={index} data-diff="insert" className="rounded-[3px] bg-[#cdeede] font-semibold text-[#12694a]">
              {op.text}
            </span>
          ),
        )}
    </>
  );
}

const rowGrid =
  "grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2 px-1 font-mono text-[13px] leading-6 max-[430px]:grid-cols-[2.25rem_minmax(0,1fr)] max-[430px]:text-xs";

export function TextComparisonRows({
  rows,
  renderDetails,
}: {
  rows: readonly TextComparisonRow[];
  renderDetails?: (row: TextComparisonRow) => ReactNode;
}) {
  if (rows.length === 0)
    return <p className="p-6 text-center text-xs text-muted-foreground">暂无可比较正文</p>;
  return (
    <div className="grid gap-1">
      {rows.map((row) =>
        row.ops === null ? (
          <div key={row.key} className={cn(rowGrid, "text-[#3c4650]")}>
            <span className="text-right text-[#a3adb6] select-none">{row.afterLineNo}</span>
            <span className="min-w-0 break-all whitespace-pre-wrap">{row.after}</span>
          </div>
        ) : (
          <div key={row.key} className="overflow-hidden rounded-md border border-[#e5d9d9]">
            <div className={cn(rowGrid, "bg-[#fef3f3] text-[#3c4650]")}>
              <span className="text-right text-[#a3adb6] select-none">{row.beforeLineNo ?? "−"}</span>
              <div className="min-w-0 break-all whitespace-pre-wrap">
                <DiffText ops={row.ops} side="before" />
              </div>
            </div>
            <div className={cn(rowGrid, "border-t border-[#dcebe2] bg-[#f2fbf6] text-[#3c4650]")}>
              <span className="text-right text-[#a3adb6] select-none">{row.afterLineNo ?? "+"}</span>
              <div className="min-w-0 break-all whitespace-pre-wrap">
                <DiffText ops={row.ops} side="after" />
              </div>
            </div>
            {renderDetails ? renderDetails(row) : null}
          </div>
        ),
      )}
    </div>
  );
}

export function TextComparison({
  title,
  badge,
  description,
  beforeLines,
  afterLines,
  onExit,
  exitLabel = "退出比较",
  ariaLabel = "文本比较视图",
  renderDetails,
}: {
  title: string;
  badge?: string;
  description?: string;
  beforeLines: readonly string[];
  afterLines: readonly string[];
  onExit: () => void;
  exitLabel?: string;
  ariaLabel?: string;
  renderDetails?: (row: TextComparisonRow) => ReactNode;
}) {
  const rows = compareTextLines(beforeLines, afterLines);
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-white shadow-panel" aria-label={ariaLabel}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <GitCompareArrows size={15} className="shrink-0 text-primary" aria-hidden="true" />
          <p className="min-w-0 truncate text-[13px] font-bold text-[#232a31]">{title}</p>
          {badge ? <span className="shrink-0 rounded bg-secondary px-1.5 py-px text-[10px] font-semibold text-secondary-foreground">{badge}</span> : null}
        </div>
        <Button variant="outline" size="sm" className="h-7 px-2" onClick={onExit}>
          <X size={13} />
          {exitLabel}
        </Button>
      </header>
      {description ? <p className="border-b border-border bg-[#fbfcfc] px-4 py-1.5 text-[11px] text-muted-foreground">{description}</p> : null}
      <div className="max-h-[calc(100vh-220px)] overflow-auto p-2 max-[840px]:max-h-[calc(100dvh-150px)] max-[430px]:p-1.5">
        <TextComparisonRows rows={rows} {...(renderDetails ? { renderDetails } : {})} />
      </div>
    </section>
  );
}
