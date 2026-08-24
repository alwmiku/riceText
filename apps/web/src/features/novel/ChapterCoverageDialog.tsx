import { Fragment, useState } from "react";

/** 覆盖检查使用的章节信息。 */
export interface CoverageChapter {
  id: string;
  title: string;
  charCount: number;
  /** 在导入原文中的起始偏移；手动添加的章节为 null。 */
  start: number | null;
  /** 在导入原文中的结束偏移（不含）；手动添加的章节为 null。 */
  end: number | null;
  /** 章节正文开头片段，用于与原文对比。 */
  preview: string;
}

/** 章节与上一章之间的切割状态。 */
export type CoverageStatus = "ok" | "gap" | "overlap" | "manual" | "start";

export interface CoverageCheck {
  index: number;
  status: CoverageStatus;
  /** gap 时缺失的字符数。 */
  gapChars: number;
}

export interface CoverageAnalysis {
  totalChars: number;
  checks: CoverageCheck[];
  continuous: boolean;
}

/** 检查所有章节是否连续覆盖原文，无丢失、无重叠。 */
export function analyzeCoverage(
  chapters: readonly CoverageChapter[],
): CoverageAnalysis {
  const ranged = chapters.filter(
    (chapter) => chapter.start !== null && chapter.end !== null,
  );
  const totalChars = ranged.reduce(
    (max, chapter) => Math.max(max, chapter.end ?? 0),
    0,
  );
  const checks: CoverageCheck[] = [];
  let continuous = true;

  chapters.forEach((chapter, index) => {
    if (chapter.start === null || chapter.end === null) {
      checks.push({ index, status: "manual", gapChars: 0 });
      return;
    }
    if (index === 0) {
      if (chapter.start > 0) {
        checks.push({ index, status: "gap", gapChars: chapter.start });
        continuous = false;
      } else {
        checks.push({ index, status: "start", gapChars: 0 });
      }
      return;
    }
    const previous = chapters[index - 1] as CoverageChapter | undefined;
    if (!previous || previous.start === null || previous.end === null) {
      checks.push({ index, status: "ok", gapChars: 0 });
      return;
    }
    if (chapter.start === previous.end) {
      checks.push({ index, status: "ok", gapChars: 0 });
    } else if (chapter.start > previous.end) {
      checks.push({
        index,
        status: "gap",
        gapChars: chapter.start - previous.end,
      });
      continuous = false;
    } else {
      checks.push({
        index,
        status: "overlap",
        gapChars: previous.end - chapter.start,
      });
      continuous = false;
    }
  });

  return { totalChars, checks, continuous };
}

const statusLabels: Record<CoverageStatus, string> = {
  ok: "接续正常",
  start: "从开头开始",
  gap: "有缺失",
  overlap: "有重叠",
  manual: "手动添加",
};

/** 章节切割覆盖对比面板：显示每章取自原文的区间与连续性。 */
export function ChapterCoverageDialog({
  chapters,
  onClose,
}: {
  chapters: readonly CoverageChapter[];
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const analysis = analyzeCoverage(chapters);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="max-h-[80vh] w-full max-w-3xl overflow-hidden rounded-lg border border-border bg-white shadow-panel">
        <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-border py-2 pr-2.5 pl-3.5 max-[430px]:min-h-12 max-[430px]:pr-3 max-[430px]:pl-3">
          <div className="min-w-0">
            <p className="min-w-0 truncate text-[15px] font-bold">
              全文覆盖对比
            </p>
            <p className="text-xs text-muted-foreground">
              共 {chapters.length} 章 · 原文{" "}
              {analysis.totalChars.toLocaleString()} 字 ·{" "}
              {analysis.continuous
                ? "章节连续覆盖全文，无缺失无重叠"
                : "存在缺失或重叠，请检查下列标记"}
            </p>
          </div>
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-sm"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        <div className="max-h-[calc(80vh-64px)] overflow-auto p-3">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="p-2">章</th>
                <th className="p-2">标题</th>
                <th className="p-2">原文区间</th>
                <th className="p-2 text-right">字数</th>
                <th className="p-2">切割状态</th>
              </tr>
            </thead>
            <tbody>
              {chapters.map((chapter, index) => {
                const check = analysis.checks[index];
                const isExpanded = expanded === index;
                return (
                  <Fragment key={chapter.id || index}>
                    <tr
                      className="cursor-pointer border-t align-top hover:bg-[#f4faf8]"
                      onClick={() => setExpanded(isExpanded ? null : index)}
                    >
                      <td className="p-2 text-muted-foreground">{index + 1}</td>
                      <td className="max-w-[260px] p-2 font-medium">
                        {chapter.title}
                      </td>
                      <td className="p-2 font-mono text-muted-foreground">
                        {chapter.start === null || chapter.end === null
                          ? "—"
                          : `[${chapter.start.toLocaleString()}, ${chapter.end.toLocaleString()})`}
                      </td>
                      <td className="p-2 text-right">
                        {chapter.charCount.toLocaleString()}
                      </td>
                      <td className="p-2">
                        <span
                          className={
                            check?.status === "ok" || check?.status === "start"
                              ? "rounded bg-[#e2efec] px-1.5 py-0.5 text-[#176e66]"
                              : check?.status === "manual"
                                ? "rounded bg-[#eef1f4] px-1.5 py-0.5 text-[#5b6670]"
                                : "rounded bg-[#fdeaea] px-1.5 py-0.5 text-[#b03a32]"
                          }
                        >
                          {check ? statusLabels[check.status] : ""}
                          {check?.status === "gap" && check.gapChars > 0
                            ? `（缺失 ${check.gapChars.toLocaleString()} 字）`
                            : ""}
                          {check?.status === "overlap" && check.gapChars > 0
                            ? `（重叠 ${check.gapChars.toLocaleString()} 字）`
                            : ""}
                        </span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key="preview">
                        <td
                          colSpan={5}
                          className="p-2 pl-6 text-muted-foreground"
                        >
                          <span className="font-medium text-[#2c3a44]">
                            正文开头：
                          </span>
                          {chapter.preview || "（空）"}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
