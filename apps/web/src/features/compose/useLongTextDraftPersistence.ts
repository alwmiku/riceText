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

/** 只负责长文本草稿的代次跟踪和本机持久化，不处理工作区命令。 */
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
  // ref 供异步保存读取最新代次，state 只用于触发防抖 effect。
  const [generation, setGeneration] = useState(0);
  const generationRef = useRef(0);
  const savedGenerationRef = useRef(0);
  const readyRef = useRef(false);

  const markChanged = useCallback(() => {
    generationRef.current += 1;
    setGeneration(generationRef.current);
  }, []);

  // 进入、恢复和退出工作区时暂停写回，并把当前代次视为基线，避免空文档覆盖旧草稿。
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

  // 每次变更重置 1.2 秒定时器；成功后记录代次，避免相同快照重复落盘。
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
