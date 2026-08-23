import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, saveDocument } from "../../lib/api";
import { createId } from "../../lib/utils";
import type {
  DocumentEnvelope,
  RichTextNode,
  SaveState,
} from "../../lib/types";

/** 自动保存对页面暴露的只读状态与显式操作。 */
export interface AutosaveResult {
  /** 当前保存状态，用于渲染保存中、冲突、离线或失败提示。 */
  state: SaveState;
  /** 客户端已经确认的最新服务端或本地 revision。 */
  revision: number;
  /** 最近一次成功保存的时间。 */
  savedAt: string;
  /** 冲突或普通保存错误的用户可读信息。 */
  conflictMessage: string;
  /** 立即把最新编辑代次排入串行保存队列，可传入当前编辑器快照强制使用最新正文。 */
  flush: (content?: RichTextNode, generation?: number) => Promise<boolean>;
  /** 用户确认采用服务器 revision 后解除冲突阻塞。 */
  acceptLatest: (latestRevision: number) => void;
}

/** 自动保存输入；generation 由宿主在每次真实正文变更时递增。 */
export interface AutosaveOptions {
  /** 当前文档元数据和保存基线。 */
  document: DocumentEnvelope;
  /** 始终指向编辑器最新的 Tiptap JSON。 */
  content: RichTextNode;
  /** 单调递增的本地编辑代次，避免使用昂贵的全文 Hash。 */
  generation: number;
  /** 本次编辑的章节 id；服务端保存成功后递增该章节版本号。 */
  chapterId?: string;
  /** 关闭时保留状态接口，但不安排任何网络保存。 */
  enabled?: boolean;
  /** 成功保存后的宿主同步回调。 */
  onSaved?: (next: DocumentEnvelope) => void;
}

/**
 * 提供 1.2 秒防抖、串行写入、revision 冲突和失败代次阻断。
 *
 * 请求永不并发：输入发生在请求期间时，后一代会在前一请求完成后使用新的 revision。
 */
export function useAutosave({
  document,
  content,
  generation,
  chapterId,
  enabled = true,
  onSaved,
}: AutosaveOptions): AutosaveResult {
  const [state, setState] = useState<SaveState>("saved");
  const [revision, setRevision] = useState(document.revision);
  const [savedAt, setSavedAt] = useState(document.savedAt);
  const [conflictMessage, setConflictMessage] = useState("");
  const revisionRef = useRef(document.revision);
  const latestRef = useRef({ content, generation });
  const savedGeneration = useRef(generation);
  const failedGeneration = useRef<number | null>(null);
  const queueRef = useRef(Promise.resolve());
  const timerRef = useRef<number | null>(null);
  const onSavedRef = useRef(onSaved);
  const chapterIdRef = useRef(chapterId);

  // 回调与正文必须保持最新，但它们不应重建 enqueue 或清空正在执行的保存队列。
  latestRef.current = { content, generation };
  onSavedRef.current = onSaved;
  chapterIdRef.current = chapterId;

  // 宿主收到服务端/本地保存结果时，同步 revision 基线并解除旧失败代次。
  // 保存回调已通过 revisionRef 记录新基线；只有外部同步（回滚/刷新装载）才重置
  // savedGeneration，避免把保存期间产生的新编辑代次误标记为“已保存”。
  useEffect(() => {
    const baselineChangedExternally = revisionRef.current !== document.revision;
    revisionRef.current = document.revision;
    setRevision(document.revision);
    setSavedAt(document.savedAt);
    if (baselineChangedExternally) {
      savedGeneration.current = generation;
      failedGeneration.current = null;
    }
    setState(document.storage === "local-demo" ? "offline" : "saved");
  }, [document.id, document.revision, document.savedAt, document.storage]);

  const enqueue = useCallback(
    async (
      force = false,
      override?: { content: RichTextNode; generation: number },
    ): Promise<boolean> => {
      const snapshot = override ?? latestRef.current;
      if (!enabled) return true;
      // 同一代已经保存时不重复提交；自动保存会跳过明确失败的代次，显式 flush 可重试。
      if (
        snapshot.generation <= savedGeneration.current ||
        (!force && snapshot.generation === failedGeneration.current)
      )
        return true;
      setState("saving");
      let succeeded = true;
      // Promise 链保证任意时刻只有一个 PUT；catch 先清除上一请求的拒绝状态。
      queueRef.current = queueRef.current
        .catch(() => undefined)
        .then(async () => {
          const result = await saveDocument(document.id, {
            schemaVersion: document.schemaVersion,
            baseRevision: revisionRef.current,
            clientMutationId: createId("save"),
            content: snapshot.content,
            ...(chapterIdRef.current
              ? { chapterId: chapterIdRef.current }
              : {}),
          });
          revisionRef.current = result.revision;
          savedGeneration.current = snapshot.generation;
          failedGeneration.current = null;
          setRevision(result.revision);
          setSavedAt(result.savedAt);
          setState(
            result.storage === "local-demo"
              ? "offline"
              : snapshot.generation === latestRef.current.generation
                ? "saved"
                : "dirty",
          );
          onSavedRef.current?.(result);
        })
        .catch((error: unknown) => {
          succeeded = false;
          if (error instanceof ApiError && error.status === 409) {
            // 409 必须保留本地正文并等待用户决策，绝不自动覆盖服务器版本。
            setConflictMessage(
              "服务器已有更新版本。本地内容仍保留，请比较后选择加载最新版或继续复制。",
            );
            setState("conflict");
          } else {
            failedGeneration.current = snapshot.generation;
            setConflictMessage(
              error instanceof Error ? error.message : "自动保存失败",
            );
            setState("error");
          }
        });
      await queueRef.current;
      return succeeded;
    },
    [document.id, document.schemaVersion, enabled],
  );

  // 新编辑代在静默 1.2 秒后入队；卸载或继续输入会取消旧定时器。
  useEffect(() => {
    if (
      !enabled ||
      generation <= savedGeneration.current ||
      state === "conflict" ||
      (state === "error" && generation === failedGeneration.current)
    )
      return;
    setState("dirty");
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void enqueue(), 1200);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [enabled, enqueue, generation, state]);

  return {
    state,
    revision,
    savedAt,
    conflictMessage,
    flush: (contentOverride, generationOverride) =>
      enqueue(
        true,
        contentOverride && generationOverride !== undefined
          ? { content: contentOverride, generation: generationOverride }
          : undefined,
      ),
    acceptLatest(latestRevision) {
      // 只更新并发基线，不在这里改正文；正文取舍由冲突 UI 的用户操作负责。
      revisionRef.current = latestRevision;
      failedGeneration.current = null;
      setRevision(latestRevision);
      setConflictMessage("");
      setState("dirty");
    },
  };
}
