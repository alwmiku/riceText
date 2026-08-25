import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDocument, restoreRevision } from "../../lib/api";
import { mergeChapter } from "../../lib/chapters";
import { defaultDocument } from "../../lib/seed";
import type { DocumentEnvelope, RichTextNode } from "../../lib/types";
import { useAutosave } from "../editor/useAutosave";

export interface ComposeDocumentController {
  document: DocumentEnvelope;
  content: RichTextNode;
  contentRef: MutableRefObject<RichTextNode>;
  generation: number;
  isPlaceholderData: boolean;
  autosave: ReturnType<typeof useAutosave>;
  setAutosaveEnabled: (enabled: boolean) => void;
  replaceContent: (next: RichTextNode) => void;
  updateChapter: (chapterIndex: number, chapter: RichTextNode) => void;
  publishChapter: (
    chapterIndex: number,
    latestChapter?: RichTextNode,
  ) => Promise<boolean>;
  rollback: (revision: number) => Promise<DocumentEnvelope>;
}

/** Owns the server-backed document, edit generation, autosave, publish and rollback lifecycle. */
export function useComposeDocument(
  documentId: string,
  chapterId?: string,
): ComposeDocumentController {
  const queryClient = useQueryClient();
  const { data = defaultDocument, isPlaceholderData } = useQuery({
    queryKey: ["document", documentId],
    queryFn: ({ signal }) => getDocument(documentId, signal),
    placeholderData: defaultDocument,
  });
  const [document, setDocument] = useState<DocumentEnvelope>(data);
  const [content, setContent] = useState<RichTextNode>(data.content);
  const [generation, setGeneration] = useState(0);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const contentRef = useRef<RichTextNode>(data.content);
  const generationRef = useRef(0);

  useEffect(() => {
    if (generationRef.current !== 0) return;
    if (data.revision <= document.revision) return;
    setDocument(data);
    contentRef.current = data.content;
    generationRef.current = 0;
    setContent(data.content);
  }, [data, document.revision]);

  const replaceContent = useCallback((next: RichTextNode) => {
    contentRef.current = next;
    generationRef.current += 1;
    setContent(next);
    setGeneration(generationRef.current);
  }, []);

  const autosave = useAutosave({
    document,
    content,
    generation,
    ...(chapterId ? { chapterId } : {}),
    enabled: autosaveEnabled,
    onSaved: (next) => {
      setDocument((current) => ({
        ...current,
        content: next.content,
        revision: next.revision,
        savedAt: next.savedAt,
        storage: next.storage ?? current.storage ?? "server",
      }));
      queryClient.setQueryData<DocumentEnvelope>(["document", next.id], next);
      void queryClient.invalidateQueries({ queryKey: ["revisions", next.id] });
      void queryClient.invalidateQueries({ queryKey: ["demo", "chapters"] });
    },
  });

  const updateChapter = useCallback(
    (chapterIndex: number, chapter: RichTextNode) => {
      replaceContent(mergeChapter(contentRef.current, chapterIndex, chapter));
    },
    [replaceContent],
  );

  const publishChapter = useCallback(
    async (chapterIndex: number, latestChapter?: RichTextNode) => {
      if (isPlaceholderData) return false;
      if (latestChapter) {
        const next = mergeChapter(
          contentRef.current,
          chapterIndex,
          latestChapter,
        );
        if (JSON.stringify(next) !== JSON.stringify(contentRef.current)) {
          replaceContent(next);
        }
      }
      return autosave.flush(contentRef.current, generationRef.current);
    },
    [autosave, isPlaceholderData, replaceContent],
  );

  const rollback = useCallback(
    async (revision: number) => {
      const next = await restoreRevision(
        document.id,
        revision,
        autosave.revision,
      );
      setDocument(next);
      queryClient.setQueryData<DocumentEnvelope>(["document", next.id], next);
      contentRef.current = next.content;
      generationRef.current += 1;
      setContent(next.content);
      setGeneration(generationRef.current);
      return next;
    },
    [autosave.revision, document.id, queryClient],
  );

  return {
    document,
    content,
    contentRef,
    generation,
    isPlaceholderData,
    autosave,
    setAutosaveEnabled,
    replaceContent,
    updateChapter,
    publishChapter,
    rollback,
  };
}
