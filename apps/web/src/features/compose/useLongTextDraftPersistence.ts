import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { saveLongTextDraft } from "../../lib/long-text-draft-storage";
import type { RichTextNode } from "../../lib/types";

const WRITE_DELAY = 1200;

/** Persists changed long-text snapshots locally without owning workspace commands. */
export function useLongTextDraftPersistence({
  enabled,
  draftKey,
  contentRef,
  onError,
}: {
  enabled: boolean;
  draftKey: string;
  contentRef: MutableRefObject<RichTextNode>;
  onError: () => void;
}) {
  const [generation, setGeneration] = useState(0);
  const generationRef = useRef(0);
  const savedGenerationRef = useRef(0);
  const readyRef = useRef(false);

  const markChanged = useCallback(() => {
    generationRef.current += 1;
    setGeneration(generationRef.current);
  }, []);

  const suspend = useCallback(() => {
    readyRef.current = false;
    savedGenerationRef.current = generationRef.current;
  }, []);

  const resume = useCallback(() => {
    readyRef.current = true;
  }, []);

  const saveNow = useCallback(async () => {
    await saveLongTextDraft(draftKey, contentRef.current);
    savedGenerationRef.current = generationRef.current;
  }, [contentRef, draftKey]);

  useEffect(() => {
    if (!enabled || !readyRef.current) return;
    if (generation <= savedGenerationRef.current) return;
    const timer = window.setTimeout(() => {
      void saveNow().catch(onError);
    }, WRITE_DELAY);
    return () => window.clearTimeout(timer);
  }, [enabled, generation, onError, saveNow]);

  return { markChanged, suspend, resume, saveNow };
}
