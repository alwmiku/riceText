import { useQueryClient } from "@tanstack/react-query";
import type { DocumentEnvelope as ContractDocumentEnvelope } from "@ricetext/contracts";
import { diffDocumentsVerified, type StepJson } from "@ricetext/document-core";
import { FilePenLine, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Dialog } from "../../components/ui";
import { submitSuggestionBatch } from "../../lib/api";
import { mergeChapter } from "../../lib/chapters";
import type { RichTextNode } from "../../lib/types";
import { RichTextEditor } from "../editor/RichTextEditor";

/** 读者整章修订：在编辑器副本中修改多处，并合并为一个待审核批次。 */
export function ChapterSuggestionEditor({
  documentId,
  baseRevision,
  chapterId,
  chapterTitle,
  chapterIndex,
  fullContent,
  chapterContent,
}: {
  documentId: string;
  baseRevision: number;
  chapterId: string;
  chapterTitle: string;
  chapterIndex: number;
  fullContent: RichTextNode;
  chapterContent: RichTextNode;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RichTextNode>(chapterContent);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const unchanged = useMemo(
    () => JSON.stringify(draft) === JSON.stringify(chapterContent),
    [draft, chapterContent],
  );

  const setDialogOpen = (next: boolean) => {
    setOpen(next);
    if (next) {
      setDraft(structuredClone(chapterContent));
      setReason("");
      setError("");
    }
  };

  const submit = async () => {
    const merged = mergeChapter(fullContent, chapterIndex, draft);
    let steps: StepJson[];
    try {
      steps = diffDocumentsVerified(fullContent, merged);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法计算整章修改");
      return;
    }
    if (steps.length === 0) {
      setError("请至少修改一处内容后再提交");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await submitSuggestionBatch(documentId, {
        baseRevision,
        chapterId,
        chapterTitle,
        beforeContent:
          chapterContent as unknown as ContractDocumentEnvelope["content"],
        afterContent: draft as unknown as ContractDocumentEnvelope["content"],
        steps: steps as unknown as Array<Record<string, unknown>>,
        reason: reason.trim(),
      });
      await queryClient.invalidateQueries({
        queryKey: ["forum", "suggestion-batches", documentId],
      });
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "整章修订提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        aria-label="整章修订"
        onClick={() => setDialogOpen(true)}
      >
        <FilePenLine size={14} />
        <span className="max-[430px]:hidden">整章修订</span>
      </Button>
      <Dialog
        open={open}
        onOpenChange={setDialogOpen}
        title={`整章修订 · ${chapterTitle}`}
        description="可以一次修改多处内容，提交后将作为一个批次交给作者审核。"
        className="max-w-5xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button disabled={submitting || unchanged} onClick={() => void submit()}>
              <Send size={14} />
              {submitting ? "提交中…" : "合并提交全部修改"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <RichTextEditor
            key={`${documentId}:${chapterId}:${open ? "open" : "closed"}`}
            content={draft}
            mode="full"
            onChange={setDraft}
          />
          <label className="block text-xs font-semibold">
            整体说明
            <textarea
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="概括本次多处修改（选填）"
              className="mt-1.5 w-full resize-y rounded-md border border-input bg-white px-3 py-2 font-normal leading-5 outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          {error ? (
            <p
              role="alert"
              className="rounded bg-[#fdf1f0] px-3 py-2 text-xs text-[#8f2b24]"
            >
              {error}
            </p>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
