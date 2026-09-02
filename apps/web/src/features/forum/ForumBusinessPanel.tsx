import { History, MessageSquareText, Paperclip, Vote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { RichTextNode, SeedIdentity } from "../../lib/types";
import { cn } from "../../lib/utils";
import { AttachmentPanel } from "./AttachmentPanel";
import { HistoryPanel } from "./HistoryPanel";
import { PollPanel } from "./PollPanel";
import { SuggestionPanel } from "./SuggestionPanel";
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

/** 汇总校订、附件、投票和版本历史等论坛创作能力。 */
export function ForumBusinessPanel({
  identity,
  documentId,
  baseRevision,
  chapterId,
  chapterTitle,
  activeContent,
  comparingRevision,
  onCompare,
  onRestore,
  className,
}: {
  identity: SeedIdentity;
  documentId: string;
  /** 当前文档 revision，作为审核建议合并的基线。 */
  baseRevision: number;
  /** 当前编辑章节的服务器目录 id；新建章节未注册时为空（历史面板显示暂无）。 */
  chapterId?: string | undefined;
  chapterTitle: string;
  /** 当前章节正文；附件与投票 Tab 只跟随其中的引用节点。 */
  activeContent?: RichTextNode;
  comparingRevision?: number | null;
  onCompare?: (revision: number) => void;
  onRestore: (revision: number) => void;
  className?: string;
}) {
  const [tab, setTab] = useState<
    "suggestions" | "attachment" | "poll" | "history"
  >("suggestions");
  const { revisions } = useRevisions(documentId, chapterId);
  const { attachmentIds, pollIds } = useMemo(
    () => collectBusinessReferences(activeContent),
    [activeContent],
  );
  const tabs = [
    { id: "suggestions" as const, label: "校订", icon: MessageSquareText },
    ...(attachmentIds.length > 0
      ? [{ id: "attachment" as const, label: "附件", icon: Paperclip }]
      : []),
    ...(pollIds.length > 0
      ? [{ id: "poll" as const, label: "投票", icon: Vote }]
      : []),
    { id: "history" as const, label: "历史", icon: History },
  ];
  useEffect(() => {
    if (
      (tab === "attachment" && attachmentIds.length === 0) ||
      (tab === "poll" && pollIds.length === 0)
    )
      setTab("suggestions");
  }, [attachmentIds.length, pollIds.length, tab]);
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
        {tabs.map(({ id, label, icon: Icon }) => (
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
      <div className="p-3">
        {tab === "suggestions" && (
          <SuggestionPanel
            documentId={documentId}
            baseRevision={baseRevision}
            chapterId={chapterId ?? ""}
            chapterTitle={chapterTitle}
          />
        )}
        {tab === "attachment" && (
          <AttachmentPanel identity={identity} attachmentIds={attachmentIds} />
        )}
        {tab === "poll" && (
          <div className="flex flex-col gap-3">
            {pollIds.map((pollId) => (
              <PollPanel key={pollId} pollId={pollId} />
            ))}
          </div>
        )}
        {tab === "history" && (
          <HistoryPanel
            revisions={revisions}
            {...(comparingRevision !== undefined ? { comparingRevision } : {})}
            {...(onCompare ? { onCompare } : {})}
            onRestore={onRestore}
          />
        )}
      </div>
    </aside>
  );
}
