import { Check, X } from "lucide-react";
import { useMemo } from "react";
import { Button } from "../../components/ui";
import type { ForumSuggestion } from "../../lib/api";
import { cn } from "../../lib/utils";
import {
  TextComparison,
  compareTextLines,
  type TextComparisonRow,
} from "../comparison/TextComparison";
import { applySuggestionsToLine } from "./char-diff";

function SuggestionDetails({
  suggestions,
  busyId,
  onReview,
}: {
  suggestions: readonly ForumSuggestion[];
  busyId?: string | null;
  onReview?: (id: string, decision: "approve" | "reject") => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="grid gap-2 border-t border-[#eef0f1] bg-white px-2 py-2 text-[11px] text-muted-foreground">
      {suggestions.map((suggestion) => (
        <div key={suggestion.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-primary">第 {suggestion.lineNo} 行</span>
          <span className="min-w-0 flex-1 text-[#8a939c]">
            {suggestion.authorId}：{suggestion.reason || "无说明"}
          </span>
          <span
            className={cn(
              "rounded px-1 py-px text-[10px] font-semibold",
              suggestion.status === "pending" && "bg-[#fff6e0] text-[#8a5a10]",
              suggestion.status === "approved" && "bg-[#e2f4ec] text-[#176e66]",
              suggestion.status === "rejected" && "bg-[#fdeaea] text-[#a33a3a]",
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
              <Button size="sm" className="h-7 px-2.5" disabled={busyId != null} onClick={() => onReview(suggestion.id, "approve")}>
                <Check size={12} />接受
              </Button>
              <Button size="sm" variant="outline" className="h-7 px-2.5" disabled={busyId != null} onClick={() => onReview(suggestion.id, "reject")}>
                <X size={12} />拒绝
              </Button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** 校订审核适配层：把校订建议转换为通用文本比较接口所需的数据与操作。 */
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
  busyId?: string | null;
  onReview?: (id: string, decision: "approve" | "reject") => void;
  onExit: () => void;
}) {
  const activeSuggestions = useMemo(
    () => suggestions.filter((item) => item.lineNo >= 1 && item.lineNo <= lines.length),
    [suggestions, lines.length],
  );
  const sourceLines = useMemo(
    () =>
      lines.map((line, index) => {
        const lineSuggestions = activeSuggestions.filter((item) => item.lineNo === index + 1);
        const recorded = lineSuggestions.find(
          (item) => item.lineText && item.lineText.includes(item.fromText),
        )?.lineText;
        return recorded ?? line;
      }),
    [lines, activeSuggestions],
  );
  const targetLines = useMemo(
    () =>
      sourceLines.map((line, index) =>
        applySuggestionsToLine(
          line,
          activeSuggestions.filter((item) => item.lineNo === index + 1),
        ),
      ),
    [sourceLines, activeSuggestions],
  );
  const changedCount = compareTextLines(sourceLines, targetLines).filter((row) => row.ops).length;
  const involvedLineNos = [...new Set(activeSuggestions.map((item) => item.lineNo))];
  const status = activeSuggestions[0]?.status ?? "pending";
  const statusLabel = status === "approved" ? "已接受" : status === "rejected" ? "已拒绝" : "待审";

  const details = (row: TextComparisonRow) => {
    const lineNo = row.beforeLineNo ?? row.afterLineNo;
    const lineSuggestions = activeSuggestions.filter((item) => item.lineNo === lineNo);
    return (
      <SuggestionDetails
        suggestions={lineSuggestions}
        {...(busyId !== undefined ? { busyId } : {})}
        {...(onReview ? { onReview } : {})}
      />
    );
  };

  const badge = activeSuggestions.length > 0
    ? [changedCount, " 行 ", activeSuggestions.length, " 处", statusLabel].join("")
    : "本章暂无校订";

  return (
    <TextComparison
      title={["校订《", documentTitle, "》· ", chapterTitle].join("")}
      badge={badge}
      {...(activeSuggestions.length > 0
        ? {
            description: [
              "涉及行：第 ",
              involvedLineNos.join("、"),
              " 行 · 对比单元为单个字，未修改文字与修改片段同排显示",
            ].join(""),
          }
        : {})}
      beforeLines={sourceLines}
      afterLines={targetLines}
      onExit={onExit}
      exitLabel="退出校订"
      ariaLabel="校订对比视图"
      renderDetails={details}
    />
  );
}
