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

/** 管理服务器文档、编辑代次、自动保存、显式发布和版本回滚。 */
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
  // state 驱动渲染，ref 让 autosave、发布和长文本桥接始终读取最新正文与代次。
  const [document, setDocument] = useState<DocumentEnvelope>(data);
  const [content, setContent] = useState<RichTextNode>(data.content);
  const [generation, setGeneration] = useState(0);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const contentRef = useRef<RichTextNode>(data.content);
  const generationRef = useRef(0);

  // 占位文档的 revision 只是演示元数据，不能作为服务器版本的新旧依据。
  // 首次真实编辑发生前始终接纳查询结果；编辑后则由 generationRef 阻止迟到响应覆盖正文。
  useEffect(() => {
    if (generationRef.current !== 0) return;
    if (data === document) return;
    setDocument(data);
    contentRef.current = data.content;
    generationRef.current = 0;
    setContent(data.content);
  }, [data, document]);

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
      // 保存结果更新文档基线，并刷新版本历史和独立章节版本号。
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
      // 提交快捷键可能早于 React onChange；显式合并编辑器快照后再 flush。
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
      // 服务端回滚会创建新 revision；返回内容必须同时替换本地正文和保存基线。
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
