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
  const content: RichTextNode[] = [];
  const tones: ComparisonTone[] = [];
  let changedBlocks = 0;
  const length = Math.max(historicalBlocks.length, currentBlocks.length);
  for (let index = 0; index < length; index += 1) {
    const historical = historicalBlocks[index];
    const current = currentBlocks[index];
    if (
      historical &&
      current &&
      JSON.stringify(historical) === JSON.stringify(current)
    ) {
      content.push(current);
      tones.push("unchanged");
      continue;
    }
    changedBlocks += 1;
    if (historical) {
      content.push(historical);
      tones.push("history");
    }
    if (current) {
      content.push(current);
      tones.push("current");
    }
  }
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
                  decorations.push(
                    Decoration.node(offset, offset + node.nodeSize, {
                      "data-version-side": tone,
                      "data-version-label": history ? "历史版本" : "当前版本",
                      "aria-label": history ? "历史版本内容" : "当前版本内容",
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
            版本 {historicalRevision} 与当前版本 · {chapterTitle}
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-white px-4 py-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm border-l-2 border-[#c95660] bg-[#fff1f1]" />历史版本内容</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm border-l-2 border-[#258260] bg-[#eef9f3]" />当前版本内容</span>
        <span>未变化内容只显示一次</span>
      </div>
      <div className="max-h-[calc(100vh-220px)] overflow-auto bg-white p-4 max-[840px]:max-h-[calc(100dvh-155px)] max-[430px]:p-2">
        <RichTextViewer
          content={comparison.content as JSONContent}
          additionalExtensions={extensions}
          className="min-h-[20rem] max-w-none [&_[data-version-side]]:my-2 [&_[data-version-side]]:rounded-sm [&_[data-version-side]]:border-l-[3px] [&_[data-version-side]]:px-3 [&_[data-version-side]]:py-2 [&_[data-version-side]]:before:mb-1 [&_[data-version-side]]:before:block [&_[data-version-side]]:before:text-[10px] [&_[data-version-side]]:before:font-bold [&_[data-version-side]]:before:content-[attr(data-version-label)] [&_[data-version-side=history]]:border-[#c95660] [&_[data-version-side=history]]:bg-[#fff1f1] [&_[data-version-side=history]]:before:text-[#a43842] [&_[data-version-side=current]]:border-[#258260] [&_[data-version-side=current]]:bg-[#eef9f3] [&_[data-version-side=current]]:before:text-[#176e50]"
          enableLightbox={false}
        />
      </div>
    </section>
  );
}
