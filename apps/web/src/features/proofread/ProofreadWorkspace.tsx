import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  listSuggestionBatches,
  listSuggestions,
  reviewSuggestionBatch,
  reviewSuggestion,
  type ForumSuggestion,
} from "../../lib/api";
import type { ForumSuggestionBatch } from "../../lib/types";
import { SuggestionBatchCard } from "./SuggestionBatchCard";
import { ProofreadView } from "./ProofreadView";

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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const queryKey = ["forum", "suggestions", documentId] as const;
  const batchQueryKey = ["forum", "suggestion-batches", documentId] as const;
  const { data: suggestions = [], isLoading } = useQuery({
    queryKey,
    queryFn: ({ signal }) => listSuggestions(documentId, signal),
  });
  const { data: batches = [], isLoading: batchesLoading } = useQuery({
    queryKey: batchQueryKey,
    queryFn: ({ signal }) => listSuggestionBatches(documentId, signal),
  });

  useEffect(() => {
    revisionRef.current = baseRevision;
  }, [baseRevision]);

  const chapterSuggestions = useMemo(
    () => suggestions.filter((suggestion) => suggestion.chapterId === chapterId),
    [suggestions, chapterId],
  );
  const chapterBatches = useMemo(
    () => batches.filter((batch) => batch.chapterId === chapterId),
    [batches, chapterId],
  );
  const visibleSuggestions = useMemo(
    () =>
      chapterSuggestions.filter(
        (suggestion) => suggestion.status === "pending",
      ),
    [chapterSuggestions],
  );

  const visibleBatches = useMemo(
    () => chapterBatches.filter((batch) => batch.status === "pending"),
    [chapterBatches],
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

  const reviewBatch = async (
    id: string,
    decision: "approve" | "reject",
  ) => {
    if (busyId) return;
    setBusyId(id);
    setError("");
    try {
      const result = await reviewSuggestionBatch(
        id,
        decision,
        revisionRef.current,
      );
      queryClient.setQueryData<ForumSuggestionBatch[]>(
        batchQueryKey,
        (current = []) =>
          current.map((item) => (item.id === id ? result.batch : item)),
      );
      if (result.document) {
        revisionRef.current = result.document.revision;
        queryClient.setQueryData(["document", documentId], result.document);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: batchQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["document", documentId] }),
        queryClient.invalidateQueries({ queryKey: ["revisions", documentId] }),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "批量审核失败");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-2" aria-label="阅读页校订审核">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-[#f0b4b0] bg-[#fdf1f0] px-3 py-2 text-xs text-[#8f2b24]"
        >
          {error}
        </p>
      ) : null}
      {isLoading || batchesLoading ? (
        <p className="p-6 text-center text-xs text-muted-foreground">加载校订中…</p>
      ) : (
        <div className="space-y-2">
          {visibleBatches.map((batch) => (
            <SuggestionBatchCard
              key={batch.id}
              batch={batch}
              busy={busyId !== null}
              onReview={(decision) => void reviewBatch(batch.id, decision)}
            />
          ))}
          <ProofreadView
            documentTitle={documentTitle}
            chapterTitle={chapterTitle}
            lines={lines}
            suggestions={visibleSuggestions}
            busyId={busyId}
            onReview={(id, decision) => void review(id, decision)}
            onExit={onExit}
          />
        </div>
      )}
    </div>
  );
}
