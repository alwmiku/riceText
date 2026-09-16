import { useEffect, useMemo, useState } from "react";
import type { RichTextNode, SeedIdentity } from "../../lib/types";
import type { ChapterEditingUnit } from "../../lib/chapter-editing-unit";
import { cn } from "../../lib/utils";
import {
  DEFAULT_CHAPTER_TOOLS,
  type ChapterToolContext,
  type ChapterToolDefinition,
} from "./chapter-tools";
import { useRevisions } from "./useRevisions";

function collectBusinessReferences(content: RichTextNode | undefined) {
  const attachments = new Set<string>();
  const polls = new Set<string>();
  const visit = (node: RichTextNode) => {
    if (node.type === "attachmentRef" && typeof node.attrs?.attachmentId === "string")
      attachments.add(node.attrs.attachmentId);
    if (node.type === "pollRef" && typeof node.attrs?.pollId === "string")
      polls.add(node.attrs.pollId);
    node.content?.forEach(visit);
  };
  if (content) visit(content);
  return { attachmentIds: [...attachments], pollIds: [...polls] };
}

/** 章节工具容器：只管理注册工具的可见性和当前选项卡。 */
export function ForumBusinessPanel({
  identity,
  unit,
  comparingRevision,
  onCompare,
  onRestore,
  tools = DEFAULT_CHAPTER_TOOLS,
  className,
}: {
  identity: SeedIdentity;
  unit: ChapterEditingUnit;
  comparingRevision?: number | null;
  onCompare?: (revision: number) => void;
  onRestore: (revision: number) => void;
  /** 宿主可追加、替换或删减工具，而无需修改面板实现。 */
  tools?: readonly ChapterToolDefinition[];
  className?: string;
}) {
  const { revisions } = useRevisions(unit.article.id, unit.chapter.id ?? undefined);
  const { attachmentIds, pollIds } = useMemo(
    () => collectBusinessReferences(unit.content),
    [unit.content],
  );
  const context: ChapterToolContext = {
    unit,
    identity,
    attachmentIds,
    pollIds,
    revisions,
    ...(comparingRevision !== undefined ? { comparingRevision } : {}),
    ...(onCompare ? { onCompare } : {}),
    onRestore,
  };
  const visibleTools = tools.filter((tool) => tool.isVisible?.(context) ?? true);
  const [tab, setTab] = useState(() => visibleTools[0]?.id ?? "");
  useEffect(() => {
    if (!visibleTools.some((tool) => tool.id === tab)) setTab(visibleTools[0]?.id ?? "");
  }, [tab, visibleTools]);
  const activeTool = visibleTools.find((tool) => tool.id === tab) ?? visibleTools[0];

  return (
    <aside
      className={cn(
        "sticky top-[76px] max-h-[calc(100vh-92px)] overflow-auto rounded-lg border border-border bg-white shadow-panel",
        className,
      )}
      aria-label="创作业务面板"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <strong className="text-sm">创作工具</strong>
        <span className="inline-flex h-5 items-center rounded border border-[#d3a859] bg-[#fff9ed] px-1.5 text-[10px] font-bold whitespace-nowrap text-[#80530a]">
          实时数据
        </span>
      </div>
      <div className="grid grid-flow-col auto-cols-fr border-b border-border">
        {visibleTools.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            onClick={() => setTab(id)}
            data-active={tab === id}
            className="grid min-h-12 place-items-center gap-0.5 border-b-2 border-transparent text-[10px] text-muted-foreground data-[active=true]:border-primary data-[active=true]:text-primary"
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      <div className="p-3">{activeTool?.render(context)}</div>
    </aside>
  );
}
