import type { LucideIcon } from "lucide-react";
import { History, MessageSquareText, Paperclip, Vote } from "lucide-react";
import type { ReactNode } from "react";
import type { RevisionSummary, SeedIdentity } from "../../lib/types";
import {
  CHAPTER_EDITOR_CAPABILITIES,
  chapterUnitCan,
  type ChapterEditingUnit,
} from "../../lib/chapter-editing-unit";
import { AttachmentPanel } from "./AttachmentPanel";
import { HistoryPanel } from "./HistoryPanel";
import { PollPanel } from "./PollPanel";
import { SuggestionPanel } from "./SuggestionPanel";

/** 单个章节工具运行时只依赖编辑单元和自身数据，不感知 ComposePage。 */
export interface ChapterToolContext {
  unit: ChapterEditingUnit;
  identity: SeedIdentity;
  attachmentIds: readonly string[];
  pollIds: readonly string[];
  revisions: readonly RevisionSummary[];
  comparingRevision?: number | null;
  onCompare?: (revision: number) => void;
  onRestore: (revision: number) => void;
}

/** 新工具实现此定义即可接入创作面板，无需修改面板的条件分支。 */
export interface ChapterToolDefinition {
  id: string;
  label: string;
  icon: LucideIcon;
  isVisible?: (context: ChapterToolContext) => boolean;
  render: (context: ChapterToolContext) => ReactNode;
}

export const DEFAULT_CHAPTER_TOOLS: readonly ChapterToolDefinition[] = [
  {
    id: "suggestions",
    label: "校订",
    icon: MessageSquareText,
    isVisible: ({ unit }) => chapterUnitCan(unit, CHAPTER_EDITOR_CAPABILITIES.proofread),
    render: ({ unit }) => (
      <SuggestionPanel
        documentId={unit.article.id}
        baseRevision={unit.article.baseRevision}
        chapterId={unit.chapter.id ?? ""}
        chapterTitle={unit.chapter.title}
      />
    ),
  },
  {
    id: "attachment",
    label: "附件",
    icon: Paperclip,
    isVisible: ({ attachmentIds }) => attachmentIds.length > 0,
    render: ({ identity, attachmentIds }) => (
      <AttachmentPanel identity={identity} attachmentIds={[...attachmentIds]} />
    ),
  },
  {
    id: "poll",
    label: "投票",
    icon: Vote,
    isVisible: ({ pollIds }) => pollIds.length > 0,
    render: ({ pollIds }) => (
      <div className="flex flex-col gap-3">
        {pollIds.map((pollId) => (
          <PollPanel key={pollId} pollId={pollId} />
        ))}
      </div>
    ),
  },
  {
    id: "history",
    label: "历史",
    icon: History,
    isVisible: ({ unit }) => chapterUnitCan(unit, CHAPTER_EDITOR_CAPABILITIES.history),
    render: ({ revisions, comparingRevision, onCompare, onRestore }) => (
      <HistoryPanel
        revisions={[...revisions]}
        {...(comparingRevision !== undefined ? { comparingRevision } : {})}
        {...(onCompare ? { onCompare } : {})}
        onRestore={onRestore}
      />
    ),
  },
];
