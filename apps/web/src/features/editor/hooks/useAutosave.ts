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
  onSaved?: (next: DocumentEnvelope, chapterId?: string) => void;
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
  const serverGenerationRef = useRef(0);
  const localGenerationRef = useRef(0);
  // 显式服务器保存保持串行；防抖定时器只负责本地草稿。
  const queueRef = useRef(Promise.resolve());
  const baselineEpochRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  // 会话身份不能只比较 id：A → B → A 时，第一轮 A 的结果仍然过期。
  const sessionRef = useRef({ documentId: document.id });
  if (sessionRef.current.documentId !== document.id) {
    sessionRef.current = { documentId: document.id };
    revisionRef.current = document.revision;
    baselineRef.current = document.content;
    serverGenerationRef.current = 0;
    localGenerationRef.current = 0;
  }
  const session = sessionRef.current;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const isCurrent = useCallback(
    () => mountedRef.current && sessionRef.current === session,
    [session],
  );

  latestRef.current = { content, generation };

  // 宿主装载服务器修订或服务器保存成功时，同步 revision 与 diff 基线。
  // 若当前正文与服务器快照不同，说明宿主恢复了同 revision 的本地草稿，
  // 此时代次仍属于“本地已保存、服务器未保存”，不能推进服务器代次。
  useEffect(() => {
    revisionRef.current = document.revision;
    setConflictMessage("");
    setRevision(document.revision);
    setSavedAt(document.savedAt);
    if (document.storage === "server") baselineRef.current = document.content;

    const current = latestRef.current;
    const matchesServer =
      JSON.stringify(current.content) === JSON.stringify(document.content);
    if (matchesServer) {
      serverGenerationRef.current = current.generation;
      localGenerationRef.current = current.generation;
      if (document.storage === "server") clearLocalDocumentDraft(document.id);
      setState(document.storage === "local-cache" ? "offline" : "saved");
    } else {
      serverGenerationRef.current = Math.min(
        serverGenerationRef.current,
        Math.max(0, current.generation - 1),
      );
      setState(
        localGenerationRef.current >= current.generation
          ? "local-saved"
          : "dirty",
      );
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
      if (!isCurrent()) return false;
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
    [document.id, isCurrent],
  );

  // 仅由保存按钮调用。请求进入同一 Promise 队列，后一快照会在前一请求完成后
  // 使用更新后的 revision 和服务器基线重新计算最小 transaction steps。
  const publish = useCallback(
    async (override?: {
      content: RichTextNode;
      generation: number;
      chapterId?: string;
    }): Promise<boolean> => {
      if (!isCurrent()) return false;
      const snapshot = override ?? latestRef.current;
      const savedChapterId = override?.chapterId ?? chapterId;
      const notifySaved = onSaved;
      const baselineEpoch = baselineEpochRef.current;
      const canApply = () =>
        isCurrent() && baselineEpoch === baselineEpochRef.current;
      if (!enabled) return true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (snapshot.generation <= serverGenerationRef.current) return true;

      // 请求期间切换/卸载也必须留下当前草稿；迟到结果不会再操作旧会话存储。
      persistLocal(
        latestRef.current.generation > snapshot.generation
          ? latestRef.current
          : snapshot,
      );
      setState("saving");
      let succeeded = true;
      queueRef.current = queueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (!canApply()) {
            succeeded = false;
            return;
          }
          if (snapshot.generation <= serverGenerationRef.current) return;
          // 与最后一次服务器确认快照比较；本地自动保存不会改变该基线。
          const steps = diffDocuments(baselineRef.current, snapshot.content);
          if (steps.length === 0) {
            serverGenerationRef.current = snapshot.generation;
            localGenerationRef.current = snapshot.generation;
            clearLocalDocumentDraft(document.id);
            setState("saved");
            if (latestRef.current.generation > snapshot.generation)
              persistLocal(latestRef.current);
            return;
          }
          // 显式保存的章节 id 优先（新章节注册后服务器分配），否则用当前编辑章节。
          const chapterId = savedChapterId;
          const result = await saveDocumentSteps(document.id, {
            schemaVersion: document.schemaVersion,
            baseRevision: revisionRef.current,
            clientMutationId: createId("save"),
            steps,
            ...(chapterId ? { chapterId } : {}),
          });
          if (!canApply()) {
            succeeded = false;
            return;
          }
          // API 离线降级只代表本机已有副本，不能推进服务器 revision 或触发 onSaved。
          if (result.storage !== "server") {
            persistLocal(
              latestRef.current.generation > snapshot.generation
                ? latestRef.current
                : snapshot,
            );
            succeeded = false;
            setState("offline");
            return;
          }
          // 只有服务器确认后才同时推进 revision、diff 基线和服务器保存代次。
          revisionRef.current = result.revision;
          baselineRef.current = result.content;
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
          if (latestRef.current.generation > snapshot.generation) {
            persistLocal(latestRef.current);
          }
          notifySaved?.(result, savedChapterId);
        })
        .catch((error: unknown) => {
          succeeded = false;
          if (!canApply()) return;
          // 无论网络失败还是 revision 冲突，都先保证当前快照仍留在本机。
          persistLocal(
            latestRef.current.generation > snapshot.generation
              ? latestRef.current
              : snapshot,
          );
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
    [
      chapterId,
      document.id,
      document.schemaVersion,
      enabled,
      isCurrent,
      onSaved,
      persistLocal,
    ],
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
  }, [
    content,
    document.revision,
    document.content,
    enabled,
    generation,
    persistLocal,
  ]);

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
      return persistLocal({
        content: savedContent,
        generation: savedGeneration,
      });
    },
    acceptSaved(next, savedContent, savedGeneration) {
      if (!isCurrent() || next.id !== document.id) return;
      baselineEpochRef.current += 1;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      revisionRef.current = next.revision;
      baselineRef.current = next.content;
      serverGenerationRef.current = savedGeneration;
      localGenerationRef.current = savedGeneration;
      clearLocalDocumentDraft(document.id);
      setRevision(next.revision);
      setSavedAt(next.savedAt);
      setConflictMessage("");
      setState("saved");
      if (
        latestRef.current.generation > savedGeneration ||
        JSON.stringify(savedContent) !== JSON.stringify(next.content)
      ) {
        persistLocal(latestRef.current);
        serverGenerationRef.current = Math.min(
          savedGeneration,
          latestRef.current.generation - 1,
        );
      }
      onSaved?.(next);
    },
    acceptLatest(latestRevision) {
      if (!isCurrent()) return;
      // 只更新并发基线，不在这里改正文；正文取舍由冲突 UI 的用户操作负责。
      revisionRef.current = latestRevision;
      setRevision(latestRevision);
      setConflictMessage("");
      setState("dirty");
    },
  };
}
