import { diffDocuments } from "@ricetext/document-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, saveDocumentSteps } from "../../../lib/api";
import {
  clearLocalDocumentDraft,
  saveLocalDocumentDraft,
} from "../../../lib/local-document-draft-storage";
import { createId } from "../../../lib/utils";
import type {
  DocumentEnvelope,
  RichTextNode,
  SaveState,
} from "../../../lib/types";

/** 保存控制器对页面暴露的只读状态与显式操作。 */
export interface AutosaveResult {
  /** 当前保存状态，用于渲染本地保存、服务器保存、冲突或失败提示。 */
  state: SaveState;
  /** 客户端已经确认的最新服务器 revision；本地保存不会递增。 */
  revision: number;
  /** 最近一次本地或服务器保存时间。 */
  savedAt: string;
  /** 冲突或普通保存错误的用户可读信息。 */
  conflictMessage: string;
  /**
   * 仅由显式保存按钮调用：上传服务器最小 transaction steps。
   * chapterIdOverride 允许宿主在保存前完成新章节注册后，把服务器分配的章节 id
   * 传入本次保存（历史与独立版本号按该 id 归集）；缺省沿用自动保存的章节 id。
   */
  flush: (
    content?: RichTextNode,
    generation?: number,
    chapterIdOverride?: string,
  ) => Promise<boolean>;
  /** 游客显式保存时只写浏览器草稿，不发服务器请求。 */
  saveLocal: (content: RichTextNode, generation: number) => boolean;
  /** 首次整篇创建由宿主完成后，同步服务器基线并取消待执行的本地草稿定时器。 */
  acceptSaved: (
    next: DocumentEnvelope,
    content: RichTextNode,
    generation: number,
  ) => void;
  /** 用户确认采用服务器 revision 后解除冲突阻塞。 */
  acceptLatest: (latestRevision: number) => void;
}

/** 保存控制器输入；generation 由宿主在每次真实正文变更时递增。 */
export interface AutosaveOptions {
  /** 当前文档元数据和服务器保存基线。 */
  document: DocumentEnvelope;
  /** 始终指向编辑器最新的 Tiptap JSON。 */
  content: RichTextNode;
  /** 单调递增的本地编辑代次，避免使用昂贵的全文 Hash。 */
  generation: number;
  /** 本次编辑的章节 id；服务器保存成功后递增该章节版本号。 */
  chapterId?: string;
  /** 关闭时保留状态接口，但不安排本地保存或网络保存。 */
  enabled?: boolean;
  /** 服务器确认保存后的宿主同步回调。 */
  onSaved?: (next: DocumentEnvelope) => void;
}

/**
 * 本地自动保存 + 显式服务器保存。
 *
 * 编辑静默 1.2 秒后只写浏览器草稿；只有 flush 才计算并上传最小 steps。
 * 网络请求保持串行，服务器 revision 只在服务端确认成功后推进。
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
  // 服务端基线只在服务器确认后推进；本地草稿永远基于该快照生成最小 steps。
  const revisionRef = useRef(document.revision);
  const baselineRef = useRef(document.content);
  // 最新编辑快照与两个保存代次分开记录：本地保存不能冒充服务器保存。
  const latestRef = useRef({ content, generation });
  const serverGenerationRef = useRef(generation);
  const localGenerationRef = useRef(generation);
  // 显式服务器保存保持串行；防抖定时器只负责本地草稿。
  const queueRef = useRef(Promise.resolve());
  const timerRef = useRef<number | null>(null);
  const onSavedRef = useRef(onSaved);
  const chapterIdRef = useRef(chapterId);

  latestRef.current = { content, generation };
  onSavedRef.current = onSaved;
  chapterIdRef.current = chapterId;

  // 宿主装载服务器修订或服务器保存成功时，同步 revision 与 diff 基线。
  // 若当前正文与服务器快照不同，说明宿主恢复了同 revision 的本地草稿，
  // 此时代次仍属于“本地已保存、服务器未保存”，不能推进服务器代次。
  useEffect(() => {
    revisionRef.current = document.revision;
    setRevision(document.revision);
    setSavedAt(document.savedAt);
    if (document.storage === "server") baselineRef.current = document.content;

    const current = latestRef.current;
    const matchesServer =
      JSON.stringify(current.content) === JSON.stringify(document.content);
    if (matchesServer) {
      serverGenerationRef.current = current.generation;
      localGenerationRef.current = current.generation;
      clearLocalDocumentDraft(document.id);
      setState(document.storage === "local-cache" ? "offline" : "saved");
    } else {
      serverGenerationRef.current = Math.min(
        serverGenerationRef.current,
        Math.max(0, current.generation - 1),
      );
      localGenerationRef.current = current.generation;
      setState("local-saved");
    }
  }, [
    document.id,
    document.revision,
    document.savedAt,
    document.storage,
    document.content,
  ]);

  // 本地持久化是自动保存的唯一副作用；配额或序列化失败必须转为可见错误，
  // 不能影响编辑器内仍然保留的正文。
  const persistLocal = useCallback(
    (snapshot: { content: RichTextNode; generation: number }): boolean => {
      try {
        const timestamp = new Date().toISOString();
        saveLocalDocumentDraft({
          documentId: document.id,
          baseRevision: revisionRef.current,
          content: snapshot.content,
          savedAt: timestamp,
        });
        localGenerationRef.current = snapshot.generation;
        setSavedAt(timestamp);
        setState((current) =>
          current === "conflict"
            ? "conflict"
            : snapshot.generation === latestRef.current.generation
              ? "local-saved"
              : "dirty",
        );
        return true;
      } catch (cause) {
        setConflictMessage(
          cause instanceof Error ? cause.message : "本地自动保存失败",
        );
        setState("error");
        return false;
      }
    },
    [document.id],
  );

  // 仅由保存按钮调用。请求进入同一 Promise 队列，后一快照会在前一请求完成后
  // 使用更新后的 revision 和服务器基线重新计算最小 transaction steps。
  const publish = useCallback(
    async (override?: {
      content: RichTextNode;
      generation: number;
      chapterId?: string;
    }): Promise<boolean> => {
      const snapshot = override ?? latestRef.current;
      if (!enabled) return true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (snapshot.generation <= serverGenerationRef.current) return true;

      setState("saving");
      let succeeded = true;
      queueRef.current = queueRef.current
        .catch(() => undefined)
        .then(async () => {
          // 与最后一次服务器确认快照比较；本地自动保存不会改变该基线。
          const steps = diffDocuments(baselineRef.current, snapshot.content);
          if (steps.length === 0) {
            serverGenerationRef.current = snapshot.generation;
            localGenerationRef.current = snapshot.generation;
            clearLocalDocumentDraft(document.id);
            setState("saved");
            return;
          }
          // 显式保存的章节 id 优先（新章节注册后服务器分配），否则用当前编辑章节。
          const chapterId = override?.chapterId ?? chapterIdRef.current;
          const result = await saveDocumentSteps(document.id, {
            schemaVersion: document.schemaVersion,
            baseRevision: revisionRef.current,
            clientMutationId: createId("save"),
            steps,
            ...(chapterId ? { chapterId } : {}),
          });
          // API 离线降级只代表本机已有副本，不能推进服务器 revision 或触发 onSaved。
          if (result.storage !== "server") {
            persistLocal(snapshot);
            succeeded = false;
            setState("offline");
            return;
          }
          // 只有服务器确认后才同时推进 revision、diff 基线和服务器保存代次。
          revisionRef.current = result.revision;
          baselineRef.current = snapshot.content;
          serverGenerationRef.current = snapshot.generation;
          localGenerationRef.current = snapshot.generation;
          clearLocalDocumentDraft(document.id);
          setRevision(result.revision);
          setSavedAt(result.savedAt);
          setConflictMessage("");
          setState(
            snapshot.generation === latestRef.current.generation
              ? "saved"
              : "dirty",
          );
          onSavedRef.current?.(result);
        })
        .catch((error: unknown) => {
          succeeded = false;
          // 无论网络失败还是 revision 冲突，都先保证当前快照仍留在本机。
          persistLocal(snapshot);
          if (error instanceof ApiError && error.status === 409) {
            setConflictMessage(
              "服务器已有更新版本。本地内容仍保留，请比较后选择加载最新版或继续复制。",
            );
            setState("conflict");
          } else {
            setConflictMessage(
              error instanceof Error ? error.message : "保存失败",
            );
            setState("error");
          }
        });
      await queueRef.current;
      return succeeded;
    },
    [document.id, document.schemaVersion, enabled, persistLocal],
  );

  // 新编辑代静默 1.2 秒后只写本地草稿；继续输入或卸载会取消旧定时器。
  useEffect(() => {
    if (!enabled || generation <= localGenerationRef.current) return;
    setState("dirty");
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    const snapshot = { content, generation };
    timerRef.current = window.setTimeout(() => {
      // 该代次已成功提交服务器（例如点「保存」时 merge 产生的新代次在
      // 本地定时器触发前就完成了上传）：不要再写本地草稿，也不要把
      // 「已保存到服务器」状态改写成「已自动保存到本地」。
      if (snapshot.generation <= serverGenerationRef.current) return;
      persistLocal(snapshot);
    }, 1200);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [content, enabled, generation, persistLocal]);

  return {
    state,
    revision,
    savedAt,
    conflictMessage,
    flush: (contentOverride, generationOverride, chapterIdOverride) =>
      publish(
        contentOverride && generationOverride !== undefined
          ? {
              content: contentOverride,
              generation: generationOverride,
              ...(chapterIdOverride !== undefined
                ? { chapterId: chapterIdOverride }
                : {}),
            }
          : undefined,
      ),
    saveLocal(savedContent, savedGeneration) {
      return persistLocal({ content: savedContent, generation: savedGeneration });
    },
    acceptSaved(next, savedContent, savedGeneration) {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      revisionRef.current = next.revision;
      baselineRef.current = savedContent;
      serverGenerationRef.current = savedGeneration;
      localGenerationRef.current = savedGeneration;
      clearLocalDocumentDraft(document.id);
      setRevision(next.revision);
      setSavedAt(next.savedAt);
      setConflictMessage("");
      setState("saved");
      onSavedRef.current?.(next);
    },
    acceptLatest(latestRevision) {
      // 只更新并发基线，不在这里改正文；正文取舍由冲突 UI 的用户操作负责。
      revisionRef.current = latestRevision;
      setRevision(latestRevision);
      setConflictMessage("");
      setState("dirty");
    },
  };
}
