import { History, MessageSquareText, Paperclip, Vote } from "lucide-react";
import { useState } from "react";
import type { SeedIdentity } from "../../lib/types";
import { AttachmentPanel } from "./AttachmentPanel";
import { HistoryPanel } from "./HistoryPanel";
import { PollPanel } from "./PollPanel";
import { SuggestionPanel } from "./SuggestionPanel";
import { useRevisions } from "./useRevisions";

/** 汇总校订、附件、投票和版本历史等论坛创作能力。 */
export function ForumBusinessPanel({
  identity,
  documentId,
  baseRevision,
  chapterId,
  chapterTitle,
  onRestore,
}: {
  identity: SeedIdentity;
  documentId: string;
  /** 当前文档 revision，作为审核建议合并的基线。 */
  baseRevision: number;
  /** 当前编辑章节；校订列表只显示该章节的数据。 */
  chapterId: string;
  chapterTitle: string;
  onRestore: (revision: number) => void;
}) {
  const [tab, setTab] = useState<
    "suggestions" | "attachment" | "poll" | "history"
  >("suggestions");
  const { revisions } = useRevisions(documentId);
  const tabs = [
    { id: "suggestions" as const, label: "校订", icon: MessageSquareText },
    { id: "attachment" as const, label: "附件", icon: Paperclip },
    { id: "poll" as const, label: "投票", icon: Vote },
    { id: "history" as const, label: "历史", icon: History },
  ];
  return (
    <aside
      className="sticky top-[76px] max-h-[calc(100vh-92px)] overflow-auto rounded-lg border border-border bg-white shadow-panel"
      aria-label="创作业务面板"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <strong className="text-sm">创作工具</strong>
        <span className="inline-flex h-5 items-center rounded border border-[#d3a859] bg-[#fff9ed] px-1.5 text-[10px] font-bold whitespace-nowrap text-[#80530a]">
          实时数据
        </span>
      </div>
      <div className="grid grid-cols-4 border-b border-border">
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
            chapterId={chapterId}
            chapterTitle={chapterTitle}
          />
        )}
        {tab === "attachment" && <AttachmentPanel identity={identity} />}
        {tab === "poll" && <PollPanel pollId="poll-route" />}
        {tab === "history" && (
          <HistoryPanel revisions={revisions} onRestore={onRestore} />
        )}
      </div>
    </aside>
  );
}
