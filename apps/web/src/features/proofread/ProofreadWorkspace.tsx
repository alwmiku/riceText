import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { listSuggestions, reviewSuggestion, type ForumSuggestion } from "../../lib/api";
import { cn } from "../../lib/utils";
import { ProofreadView } from "./ProofreadView";

type SuggestionStatus = ForumSuggestion["status"];

const tabs: Array<{ id: SuggestionStatus; label: string }> = [
  { id: "pending", label: "待审核" },
  { id: "approved", label: "已接受" },
  { id: "rejected", label: "已拒绝" },
];

/** 阅读页作者审核工作区：管理状态筛选、审核请求及跨页面缓存同步。 */
export function ProofreadWorkspace({
  documentId,
  baseRevision,
  documentTitle,
  chapterId,
  chapterTitle,
  lines,
  onExit,
}: {
  documentId: string;
  baseRevision: number;
  documentTitle: string;
  chapterId: string;
  chapterTitle: string;
  lines: readonly string[];
  onExit: () => void;
}) {
  const queryClient = useQueryClient();
  const revisionRef = useRef(baseRevision);
  const [status, setStatus] = useState<SuggestionStatus>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const queryKey = ["forum", "suggestions", documentId] as const;
  const { data: suggestions = [], isLoading } = useQuery({
    queryKey,
    queryFn: ({ signal }) => listSuggestions(documentId, signal),
  });

  useEffect(() => {
    revisionRef.current = baseRevision;
  }, [baseRevision]);

  const chapterSuggestions = useMemo(
    () => suggestions.filter((suggestion) => suggestion.chapterId === chapterId),
    [suggestions, chapterId],
  );
  const counts = useMemo(
    () => ({
      pending: chapterSuggestions.filter((item) => item.status === "pending").length,
      approved: chapterSuggestions.filter((item) => item.status === "approved").length,
      rejected: chapterSuggestions.filter((item) => item.status === "rejected").length,
    }),
    [chapterSuggestions],
  );
  const visibleSuggestions = useMemo(
    () => chapterSuggestions.filter((suggestion) => suggestion.status === status),
    [chapterSuggestions, status],
  );

  const review = async (id: string, decision: "approve" | "reject") => {
    if (busyId) return;
    setBusyId(id);
    setError("");
    try {
      const result = await reviewSuggestion(id, decision, revisionRef.current);
      queryClient.setQueryData<ForumSuggestion[]>(queryKey, (current = []) =>
        current.map((item) => (item.id === id ? result.suggestion : item)),
      );
      if (result.document) {
        revisionRef.current = result.document.revision;
        queryClient.setQueryData(["document", documentId], result.document);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ["document", documentId] }),
        queryClient.invalidateQueries({ queryKey: ["revisions", documentId] }),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "审核失败");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-2" aria-label="阅读页校订审核">
      <div
        className="grid grid-cols-3 border border-border bg-white"
        role="tablist"
        aria-label="校订状态"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={status === tab.id}
            onClick={() => setStatus(tab.id)}
            className={cn(
              "flex min-h-10 items-center justify-center gap-1.5 border-b-2 border-transparent px-2 text-xs font-semibold text-muted-foreground",
              status === tab.id && "border-primary text-primary",
            )}
          >
            {tab.label}
            <span className="rounded bg-muted px-1.5 py-px text-[10px]">
              {counts[tab.id]}
            </span>
          </button>
        ))}
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-[#f0b4b0] bg-[#fdf1f0] px-3 py-2 text-xs text-[#8f2b24]"
        >
          {error}
        </p>
      ) : null}
      {isLoading ? (
        <p className="p-6 text-center text-xs text-muted-foreground">加载校订中…</p>
      ) : (
        <ProofreadView
          documentTitle={documentTitle}
          chapterTitle={chapterTitle}
          lines={lines}
          suggestions={visibleSuggestions}
          busyId={busyId}
          onReview={(id, decision) => void review(id, decision)}
          onExit={onExit}
        />
      )}
    </div>
  );
}
