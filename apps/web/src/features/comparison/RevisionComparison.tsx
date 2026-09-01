import { type Extensions, RichTextViewer, type JSONContent } from "@ricetext/editor-core";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { GitCompareArrows, X } from "lucide-react";
import { useMemo } from "react";
import { Button } from "../../components/ui";
import type { RichTextNode } from "../../lib/types";

type ComparisonTone = "unchanged" | "history" | "current";

export function buildRevisionComparison(
  historicalContent: RichTextNode,
  currentContent: RichTextNode,
): { content: RichTextNode; tones: ComparisonTone[]; changedBlocks: number } {
  const historicalBlocks = historicalContent.content ?? [];
  const currentBlocks = currentContent.content ?? [];
  const historicalKeys = historicalBlocks.map((block) => JSON.stringify(block));
  const currentKeys = currentBlocks.map((block) => JSON.stringify(block));
  const rows = historicalBlocks.length + 1;
  const columns = currentBlocks.length + 1;
  const lcs = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
  for (let historicalIndex = historicalBlocks.length - 1; historicalIndex >= 0; historicalIndex -= 1) {
    for (let currentIndex = currentBlocks.length - 1; currentIndex >= 0; currentIndex -= 1) {
      lcs[historicalIndex]![currentIndex] =
        historicalKeys[historicalIndex] === currentKeys[currentIndex]
          ? 1 + lcs[historicalIndex + 1]![currentIndex + 1]!
          : Math.max(
              lcs[historicalIndex + 1]![currentIndex]!,
              lcs[historicalIndex]![currentIndex + 1]!,
            );
    }
  }
  const anchors: Array<[number, number]> = [];
  let historicalIndex = 0;
  let currentIndex = 0;
  while (
    historicalIndex < historicalBlocks.length &&
    currentIndex < currentBlocks.length
  ) {
    if (historicalKeys[historicalIndex] === currentKeys[currentIndex]) {
      anchors.push([historicalIndex, currentIndex]);
      historicalIndex += 1;
      currentIndex += 1;
    } else if (
      lcs[historicalIndex + 1]![currentIndex]! >=
      lcs[historicalIndex]![currentIndex + 1]!
    ) {
      historicalIndex += 1;
    } else {
      currentIndex += 1;
    }
  }

  const content: RichTextNode[] = [];
  const tones: ComparisonTone[] = [];
  let changedBlocks = 0;
  let historicalStart = 0;
  let currentStart = 0;
  const appendChangedRange = (historicalEnd: number, currentEnd: number) => {
    const length = Math.max(
      historicalEnd - historicalStart,
      currentEnd - currentStart,
    );
    changedBlocks += length;
    for (let offset = 0; offset < length; offset += 1) {
      const historical = historicalBlocks[historicalStart + offset];
      const current = currentBlocks[currentStart + offset];
      if (historical && historicalStart + offset < historicalEnd) {
        content.push(historical);
        tones.push("history");
      }
      if (current && currentStart + offset < currentEnd) {
        content.push(current);
        tones.push("current");
      }
    }
  };
  for (const [historicalAnchor, currentAnchor] of anchors) {
    appendChangedRange(historicalAnchor, currentAnchor);
    content.push(currentBlocks[currentAnchor]!);
    tones.push("unchanged");
    historicalStart = historicalAnchor + 1;
    currentStart = currentAnchor + 1;
  }
  appendChangedRange(historicalBlocks.length, currentBlocks.length);
  return { content: { type: "doc", content }, tones, changedBlocks };
}

function comparisonDecorations(tones: readonly ComparisonTone[]): Extensions {
  return [
    Extension.create({
      name: "revisionComparisonDecorations",
      addProseMirrorPlugins() {
        return [
          new Plugin({
            key: new PluginKey("revisionComparisonDecorations"),
            props: {
              decorations(state) {
                const decorations: Decoration[] = [];
                state.doc.forEach((node, offset, index) => {
                  const tone = tones[index];
                  if (!tone || tone === "unchanged") return;
                  const history = tone === "history";
                  const background = history ? "#fef3f3" : "#edf9f2";
                  const divider = history ? "#d59a9f" : "#85b9a3";
                  decorations.push(
                    Decoration.node(offset, offset + node.nodeSize, {
                      "data-version-side": tone,
                      "data-node-type": node.type.name,
                      "aria-label": history ? "历史内容" : "新增或修改内容",
                      ...(node.type.name === "horizontalRule"
                        ? {
                            style: [
                              "height: 2.5rem",
                              "width: 100%",
                              "margin: 0.75rem 0",
                              "border: 0",
                              "border-radius: 0.25rem",
                              "background-color: " + background,
                              "background-image: linear-gradient(to right, transparent 14%, " + divider + " 14%, " + divider + " 86%, transparent 86%)",
                              "background-position: center",
                              "background-repeat: no-repeat",
                              "background-size: 100% 1px",
                            ].join("; "),
                          }
                        : {}),
                    }),
                  );
                });
                return DecorationSet.create(state.doc, decorations);
              },
            },
          }),
        ];
      },
    }),
  ];
}

/** 在单个只读 ProseMirror 文档流中呈现历史内容与当前内容的合并比较。 */
export function RevisionComparison({
  historicalRevision,
  chapterTitle,
  historicalContent,
  currentContent,
  onExit,
}: {
  historicalRevision: number;
  chapterTitle: string;
  historicalContent: RichTextNode;
  currentContent: RichTextNode;
  onExit: () => void;
}) {
  const comparison = useMemo(
    () => buildRevisionComparison(historicalContent, currentContent),
    [historicalContent, currentContent],
  );
  const extensions = useMemo(
    () => comparisonDecorations(comparison.tones),
    [comparison.tones],
  );
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-[#fbfcfc] shadow-panel" aria-label="版本格式比较视图">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <GitCompareArrows size={15} className="shrink-0 text-primary" aria-hidden="true" />
          <p className="min-w-0 truncate text-[13px] font-bold text-[#232a31]">
            版本 {historicalRevision} 与现有内容 · {chapterTitle}
          </p>
          <span className="shrink-0 rounded bg-secondary px-1.5 py-px text-[10px] font-semibold text-secondary-foreground">
            {comparison.changedBlocks} 处内容块变化
          </span>
        </div>
        <Button variant="outline" size="sm" className="h-7 px-2" onClick={onExit}>
          <X size={13} />
          退出比较
        </Button>
      </header>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-white px-4 py-2 text-[11px] text-muted-foreground">
        <span className="rounded-sm bg-[#fef3f3] px-2 py-1 text-[#8f3434]">历史内容</span>
        <span className="rounded-sm bg-[#edf9f2] px-2 py-1 text-[#176e50]">新增或修改内容</span>
        <span>未变化内容只显示一次</span>
      </div>
      <div className="max-h-[calc(100vh-220px)] overflow-auto bg-white p-4 max-[840px]:max-h-[calc(100dvh-155px)] max-[430px]:p-2">
        <RichTextViewer
          content={comparison.content as JSONContent}
          additionalExtensions={extensions}
          className="min-h-[20rem] max-w-none [&_.rt-inline-comment-anchor-wrap]:hidden [&_[data-version-side]]:my-2 [&_[data-version-side]]:rounded-sm [&_[data-version-side]]:px-3 [&_[data-version-side]]:py-2 [&_[data-version-side=history]]:bg-[#fef3f3] [&_[data-version-side=current]]:bg-[#edf9f2] [&_hr[data-version-side]]:px-0 [&_hr[data-version-side]]:py-0"
          enableLightbox={false}
        />
      </div>
    </section>
  );
}
