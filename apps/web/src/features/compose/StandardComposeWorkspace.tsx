import type { ReactNode } from "react";
import { Save } from "lucide-react";
import { Button } from "../../components/ui";
import { ChapterRail, DemoBusinessPanel } from "../demo/DemoPanels";
import type { SeedIdentity } from "../../lib/types";

export function StandardComposeWorkspace({
  chapters,
  activeIndex,
  title,
  saveStatus,
  editor,
  identity,
  documentId,
  revision,
  saveDisabled,
  onSelectChapter,
  onSave,
  onRestore,
}: {
  chapters: readonly { id: string; title: string }[];
  activeIndex: number;
  title: string;
  saveStatus: ReactNode;
  editor: ReactNode;
  identity: SeedIdentity;
  documentId: string;
  revision: number;
  saveDisabled: boolean;
  onSelectChapter: (index: number) => void;
  onSave: () => void;
  onRestore: (revision: number) => void;
}) {
  return (
    <div className="grid grid-cols-[220px_minmax(480px,1fr)_310px] items-start gap-3.5 max-[1180px]:grid-cols-[minmax(0,1fr)_300px] max-[1180px]:[&>*:first-child]:hidden max-[840px]:block max-[840px]:[&>aside]:hidden">
      <ChapterRail
        chapters={chapters}
        currentIndex={activeIndex}
        onSelect={onSelectChapter}
      />
      <section className="min-w-0">
        <div className="mb-2 flex min-h-[52px] items-center justify-between gap-3 rounded-lg border border-border bg-white py-2 pr-2.5 pl-3.5 shadow-panel max-[430px]:min-h-12 max-[430px]:pr-3 max-[430px]:pl-3">
          <div className="min-w-0">
            <p className="min-w-0 truncate text-[15px] font-bold">{title}</p>
            {saveStatus}
          </div>
          <Button size="sm" disabled={saveDisabled} onClick={onSave}>
            <Save size={14} />
            保存
          </Button>
        </div>
        {editor}
      </section>
      <DemoBusinessPanel
        identity={identity}
        documentId={documentId}
        baseRevision={revision}
        onRestore={onRestore}
      />
    </div>
  );
}
