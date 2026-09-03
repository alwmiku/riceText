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

/** 按草稿 key 隔离代次和在途保存，避免文章切换互相抑制写入。 */
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
  const keyRef = useRef(draftKey);
  keyRef.current = draftKey;

  useEffect(() => {
    generationRef.current = 0;
    savedGenerationRef.current = 0;
    readyRef.current = false;
    setGeneration(0);
  }, [draftKey]);

  const markChanged = useCallback(() => {
    generationRef.current += 1;
    setGeneration(generationRef.current);
  }, []);

  const suspend = useCallback(() => {
    readyRef.current = false;
  }, []);

  const resume = useCallback(() => {
    readyRef.current = true;
  }, []);

  const acceptCurrent = useCallback(() => {
    savedGenerationRef.current = generationRef.current;
  }, []);

  const saveNow = useCallback(async () => {
    const key = draftKey;
    const savedGeneration = generationRef.current;
    const snapshot = contentRef.current;
    await saveLongTextDraft(key, snapshot);
    if (keyRef.current === key) {
      savedGenerationRef.current = Math.max(
        savedGenerationRef.current,
        savedGeneration,
      );
    }
  }, [contentRef, draftKey]);

  useEffect(() => {
    if (!enabled || !readyRef.current) return;
    if (generation <= savedGenerationRef.current) return;
    const timer = window.setTimeout(() => {
      void saveNow().catch(onError);
    }, WRITE_DELAY);
    return () => window.clearTimeout(timer);
  }, [enabled, generation, onError, saveNow]);

  return { markChanged, suspend, resume, acceptCurrent, saveNow };
}
