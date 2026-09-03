import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  listForumChapters,
  syncLongTextChapters,
  uploadLongTextChapter,
} from "../../lib/api";
import type { RichTextNode } from "../../lib/types";
import { sha256Hex } from "../../lib/utils";
import { collectRawGaps } from "../novel/raw-coverage";
import type { CoverageChapter } from "../novel/ChapterCoverageDialog";
import type { ChapterUploadDiff } from "../novel/ChapterUploadDialog";

interface PreparedChapter {
  /** prepare 阶段冻结的上传载荷；confirm 不再读取可能已变化的编辑器正文。 */
  id: string;
  title: string;
  order: number;
  content: RichTextNode;
  hash: string;
  status: "新增" | "修改" | "未变化";
}

interface ChapterUploadOptions {
  novelId: string;
  getDocument: () => RichTextNode;
  getCoverage: () => readonly CoverageChapter[];
  onNotice: (notice: string) => void;
}

/** 管理冻结的章节同步计划、内容哈希以及串行增量上传。 */
export function useChapterUpload({
  novelId,
  getDocument,
  getCoverage,
  onNotice,
}: ChapterUploadOptions) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [diff, setDiff] = useState<ChapterUploadDiff | null>(null);
  const preparedRef = useRef<PreparedChapter[] | null>(null);
  // 对外回调可能随页面渲染变化；ref 让 prepare/confirm 命令保持稳定且读取最新实现。
  const getDocumentRef = useRef(getDocument);
  const getCoverageRef = useRef(getCoverage);
  const onNoticeRef = useRef(onNotice);
  getDocumentRef.current = getDocument;
  getCoverageRef.current = getCoverage;
  onNoticeRef.current = onNotice;

  const cancel = useCallback(() => {
    if (uploading) return;
    setOpen(false);
    setDiff(null);
    preparedRef.current = null;
  }, [uploading]);

  const prepare = useCallback(async () => {
    const nodes = getDocumentRef.current().content ?? [];
    if (nodes.length === 0) {
      onNoticeRef.current("当前没有可上传的章节");
      return;
    }
    setPreparing(true);
    try {
      const chapters = await Promise.all(
        nodes.map(
          async (node, order): Promise<Omit<PreparedChapter, "status">> => {
            const id = String(node.attrs?.chapterId ?? `chapter-${order}`);
            const title = String(node.attrs?.title ?? "未命名章节");
            const content: RichTextNode = {
              type: "doc",
              content: [{ ...node }],
            };
            // 标题和顺序也是章节语义的一部分，只哈希正文会漏掉改名与移动。
            const hash = await sha256Hex(
              JSON.stringify({ title, order, content }),
            );
            return { id, title, order, content, hash };
          },
        ),
      );
      const sync = await syncLongTextChapters(
        novelId,
        chapters.map(({ id, title, order, hash }) => ({
          id,
          title,
          order,
          hash,
        })),
      );
      const toUpdate = new Set(sync.toUpdate);
      const existing = new Set(sync.existing);
      const prepared: PreparedChapter[] = chapters.map((chapter) => ({
        ...chapter,
        status: !toUpdate.has(chapter.id)
          ? "未变化"
          : existing.has(chapter.id)
            ? "修改"
            : "新增",
      }));
      const added = prepared.filter(
        (chapter) => chapter.status === "新增",
      ).length;
      const modified = prepared.filter(
        (chapter) => chapter.status === "修改",
      ).length;
      preparedRef.current = prepared;
      setDiff({
        total: prepared.length,
        toUpdate: added + modified,
        added,
        modified,
        gaps: collectRawGaps(getCoverageRef.current()).length,
        rows: prepared.map(({ id, title, status }) => ({ id, title, status })),
      });
      setOpen(true);
    } catch (error) {
      preparedRef.current = null;
      onNoticeRef.current(
        error instanceof Error
          ? `无法计算章节差异：${error.message}`
          : "无法计算章节差异",
      );
    } finally {
      setPreparing(false);
    }
  }, [novelId]);

  const confirm = useCallback(async () => {
    // 必须上传 prepare 冻结的计划，不能重新读取编辑器，否则弹窗 diff 会与请求内容错位。
    const prepared = preparedRef.current;
    if (!prepared) return;
    const pending = prepared.filter((chapter) => chapter.status !== "未变化");
    if (pending.length === 0) {
      setOpen(false);
      setDiff(null);
      preparedRef.current = null;
      onNoticeRef.current("服务器章节已是最新版本，无需重复上传");
      return;
    }
    setUploading(true);
    let uploaded = 0;
    try {
      const directory = await listForumChapters(novelId);
      const revisionById = new Map(
        directory.map((chapter) => [chapter.id, chapter.revision]),
      );
      for (const chapter of pending) {
        await uploadLongTextChapter(novelId, chapter.id, {
          title: chapter.title,
          order: chapter.order,
          content: chapter.content,
          hash: chapter.hash,
          baseRevision: revisionById.get(chapter.id) ?? 0,
        });
        uploaded += 1;
      }
      setOpen(false);
      setDiff(null);
      preparedRef.current = null;
      onNoticeRef.current(`已分章上传 ${uploaded} 章`);
      void queryClient.invalidateQueries({ queryKey: ["forum", "chapters"] });
    } catch (error) {
      // 串行上传可能已部分成功；丢弃旧计划，重试时重新 sync 才能拿到正确 revision。
      setOpen(false);
      setDiff(null);
      preparedRef.current = null;
      onNoticeRef.current(
        error instanceof Error
          ? `已上传 ${uploaded} 章，随后失败：${error.message}。请重新检查差异后重试`
          : `已上传 ${uploaded} 章，随后失败。请重新检查差异后重试`,
      );
    } finally {
      setUploading(false);
    }
  }, [novelId, queryClient]);

  return {
    open,
    diff,
    preparing,
    uploading,
    prepare,
    confirm,
    cancel,
  };
}
