import { Check, GitCompareArrows, X } from "lucide-react";
import { useMemo } from "react";
import { Button } from "../../components/ui";
import type { ForumSuggestion } from "../../lib/api";
import { cn } from "../../lib/utils";
import {
  applySuggestionsToLine,
  diffChars,
  type CharDiffOp,
} from "./char-diff";

interface ProofreadLine {
  lineNo: number;
  line: string;
  /** null 表示该行没有校订，单行展示；否则为字级 diff 序列。 */
  ops: CharDiffOp[] | null;
  suggestions: ForumSuggestion[];
}

/** 单行内的字级 diff 片段：equal 混排，delete/insert 用红绿底色高亮。 */
function DiffText({ ops }: { ops: readonly CharDiffOp[] }) {
  return (
    <>
      {ops.map((op, index) =>
        op.type === "equal" ? (
          <span key={index}>{op.text}</span>
        ) : op.type === "delete" ? (
          <span
            key={index}
            data-diff="delete"
            className="rounded-[3px] bg-[#fbdada] font-semibold text-[#b4232c] line-through decoration-[#d9828a]"
          >
            {op.text}
          </span>
        ) : (
          <span
            key={index}
            data-diff="insert"
            className="rounded-[3px] bg-[#cdeede] font-semibold text-[#12694a]"
          >
            {op.text}
          </span>
        ),
      )}
    </>
  );
}

const rowGrid =
  "grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2 px-1 font-mono text-[13px] leading-6";

/** 未修改行：行号 + 单行文本。 */
function PlainRow({ lineNo, line }: { lineNo: number; line: string }) {
  return (
    <div className={cn(rowGrid, "text-[#3c4650]")}>
      <span className="text-right text-[#a3adb6] select-none">{lineNo}</span>
      <span className="min-w-0 break-all whitespace-pre-wrap">{line}</span>
    </div>
  );
}

/** 修改行：原文在上、校订后在下两行（字级高亮），下方附校订说明。 */
function ChangedRow({
  row,
  busyId,
  onReview,
}: {
  row: ProofreadLine;
  busyId?: string | null | undefined;
  onReview?:
    | ((id: string, decision: "approve" | "reject") => void)
    | undefined;
}) {
  const ops = row.ops;
  if (!ops) return null;
  const deletionSide = ops.filter((op) => op.type !== "insert");
  const insertionSide = ops.filter((op) => op.type !== "delete");
  return (
    <div className="overflow-hidden rounded-md border border-[#e5d9d9]">
      <div className={cn(rowGrid, "bg-[#fef3f3] text-[#3c4650]")}>
        <span className="text-right text-[#a3adb6] select-none">
          {row.lineNo}
        </span>
        <div className="min-w-0 break-all whitespace-pre-wrap">
          <DiffText ops={deletionSide} />
        </div>
      </div>
      <div className={cn(rowGrid, "border-t border-[#dcebe2] bg-[#f2fbf6] text-[#3c4650]")}>
        <span aria-hidden="true" />
        <div className="min-w-0 break-all whitespace-pre-wrap">
          <DiffText ops={insertionSide} />
        </div>
      </div>
      <div className="grid gap-2 border-t border-[#eef0f1] bg-white px-2 py-2 text-[11px] text-muted-foreground">
        {row.suggestions.map((suggestion) => (
          <div
            key={suggestion.id}
            className="flex flex-wrap items-center gap-x-2 gap-y-1"
          >
            <span className="font-semibold text-[#176e66]">
              第 {row.lineNo} 行
            </span>
            <span className="min-w-0 flex-1 text-[#8a939c]">
              {suggestion.authorId}：{suggestion.reason || "无说明"}
            </span>
            <span
              className={cn(
                "rounded px-1 py-px text-[10px] font-semibold",
                suggestion.status === "pending" &&
                  "bg-[#fff6e0] text-[#8a5a10]",
                suggestion.status === "approved" &&
                  "bg-[#e2f4ec] text-[#176e66]",
                suggestion.status === "rejected" &&
                  "bg-[#fdeaea] text-[#a33a3a]",
              )}
            >
              {suggestion.status === "pending"
                ? "待审"
                : suggestion.status === "approved"
                  ? "已接受"
                  : "已拒绝"}
            </span>
            {suggestion.status === "pending" && onReview ? (
              <div className="ml-auto flex gap-1.5">
                <Button
                  size="sm"
                  className="h-7 px-2.5"
                  disabled={busyId !== null && busyId !== undefined}
                  onClick={() => onReview(suggestion.id, "approve")}
                >
                  <Check size={12} />
                  接受
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2.5"
                  disabled={busyId !== null && busyId !== undefined}
                  onClick={() => onReview(suggestion.id, "reject")}
                >
                  <X size={12} />
                  拒绝
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 校订单页 diff 视图（git 风格）：
 * - 顶部标明“对哪篇文章的哪个章节进行校订”；
 * - 全章按行渲染，最小对比单元是字而不是行；
 * - 修改片段呈上下两行（原文/校订后），未变化文字与变化片段在同一行混排；
 * - 行号列与服务端校订的 lineNo 一一对应，按章过滤由调用方完成。
 */
export function ProofreadView({
  documentTitle,
  chapterTitle,
  lines,
  suggestions,
  busyId,
  onReview,
  onExit,
}: {
  documentTitle: string;
  chapterTitle: string;
  lines: readonly string[];
  suggestions: readonly ForumSuggestion[];
  busyId?: string | null | undefined;
  onReview?:
    | ((id: string, decision: "approve" | "reject") => void)
    | undefined;
  onExit: () => void;
}) {
  const rows = useMemo<ProofreadLine[]>(
    () =>
      lines.map((line, index) => {
        const lineNo = index + 1;
        const lineSuggestions = suggestions.filter(
          (suggestion) => suggestion.lineNo === lineNo,
        );
        if (lineSuggestions.length === 0)
          return { lineNo, line, ops: null, suggestions: [] };
        const sourceLine =
          lineSuggestions.find((suggestion) => suggestion.lineText)?.lineText ??
          line;
        const target = applySuggestionsToLine(sourceLine, lineSuggestions);
        return {
          lineNo,
          line: sourceLine,
          ops: diffChars(sourceLine, target),
          suggestions: lineSuggestions,
        };
      }),
    [lines, suggestions],
  );
  // 只统计确实落在本视图行范围内的校订（调用方已按章过滤）。
  const activeSuggestions = useMemo(
    () =>
      suggestions.filter(
        (suggestion) =>
          suggestion.lineNo >= 1 && suggestion.lineNo <= lines.length,
      ),
    [suggestions, lines.length],
  );
  const suggestionStatus = activeSuggestions[0]?.status ?? "pending";
  const statusLabel =
    suggestionStatus === "approved"
      ? "已接受"
      : suggestionStatus === "rejected"
        ? "已拒绝"
        : "待审";
  const changedLineNos = rows
    .filter((row) => row.ops !== null)
    .map((row) => row.lineNo);

  return (
    <section
      className="overflow-hidden rounded-lg border border-border bg-white shadow-panel"
      aria-label="校订对比视图"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <GitCompareArrows
            size={15}
            className="shrink-0 text-[#176e66]"
            aria-hidden="true"
          />
          <p className="min-w-0 truncate text-[13px] font-bold text-[#232a31]">
            校订《{documentTitle}》· {chapterTitle}
          </p>
          <span className="shrink-0 rounded bg-[#e7f5f2] px-1.5 py-px text-[10px] font-semibold text-[#176e66]">
            {activeSuggestions.length > 0
              ? `${changedLineNos.length} 行 ${activeSuggestions.length} 处${statusLabel}`
              : "本章暂无校订"}
          </span>
        </div>
        <Button variant="outline" size="sm" className="h-7 px-2" onClick={onExit}>
          <X size={13} />
          退出校订
        </Button>
      </header>
      {activeSuggestions.length > 0 ? (
        <p className="border-b border-border bg-[#fbfcfc] px-4 py-1.5 text-[11px] text-muted-foreground">
          涉及行：第 {changedLineNos.join("、")} 行 · 对比单元为单个字，
          未修改文字与修改片段同排显示
        </p>
      ) : null}
      <div className="max-h-[calc(100vh-220px)] overflow-auto p-2">
        {rows.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted-foreground">
            本章暂无正文
          </p>
        ) : (
          <div className="grid gap-1">
            {rows.map((row) =>
              row.ops === null ? (
                <PlainRow
                  key={row.lineNo}
                  lineNo={row.lineNo}
                  line={row.line}
                />
              ) : (
                <ChangedRow
                  key={row.lineNo}
                  row={row}
                  busyId={busyId}
                  onReview={onReview}
                />
              ),
            )}
          </div>
        )}
      </div>
    </section>
  );
}
