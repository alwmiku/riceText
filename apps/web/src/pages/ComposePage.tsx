import type { Editor } from "@tiptap/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CloudOff,
  LoaderCircle,
  Maximize2,
  MessageCircle,
  Monitor,
  Save,
  Smartphone,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppContext } from "../app-context";
import { Button, Dialog, Segmented } from "../components/ui";
import { CommentThread } from "../features/comments/CommentThread";
import { ChapterRail, DemoBusinessPanel } from "../features/demo/DemoPanels";
import { RichTextEditor } from "../features/editor/RichTextEditor";
import { useAutosave } from "../features/editor/useAutosave";
import { getCommentThread, getDocument, restoreRevision } from "../lib/api";
import { defaultDocument } from "../lib/seed";
import type {
  CommentReply,
  DocumentEnvelope,
  EditorMode,
  RichTextNode,
  SaveState,
} from "../lib/types";
import { formatTime } from "../lib/utils";
import { cn } from "../lib/utils";

const statusLabels: Record<SaveState, string> = {
  loading: "正在载入",
  saved: "已保存",
  dirty: "等待保存",
  saving: "正在保存",
  conflict: "版本冲突",
  offline: "本地演示副本",
  error: "保存失败",
};

/** 紧凑展示自动保存状态、revision 和最近保存时间。 */
function SaveStatus({
  state,
  revision,
  savedAt,
}: {
  state: SaveState;
  revision: number;
  savedAt: string;
}) {
  return (
    <span className="save-status" data-state={state}>
      {state === "saving" ? (
        <LoaderCircle size={12} className="animate-spin" />
      ) : state === "offline" ? (
        <CloudOff size={12} />
      ) : (
        <span className="save-dot" />
      )}
      <span>
        {statusLabels[state]} · v{revision}
      </span>
      {(state === "saved" || state === "offline") && (
        <span className="desktop-only">· {formatTime(savedAt)}</span>
      )}
    </span>
  );
}

/** 独立发帖/章节创作工作台，负责组合编辑器、历史、间贴和演示业务面板。 */
export default function ComposePage() {
  const { identity } = useAppContext();
  const queryClient = useQueryClient();
  const { data = defaultDocument, isPlaceholderData } = useQuery({
    queryKey: ["document", "demo-post"],
    queryFn: ({ signal }) => getDocument("demo-post", signal),
    placeholderData: defaultDocument,
  });
  const [document, setDocument] = useState<DocumentEnvelope>(data);
  const [content, setContent] = useState<RichTextNode>(data.content);
  const [generation, setGeneration] = useState(0);
  const contentRef = useRef<RichTextNode>(data.content);
  const generationRef = useRef(0);
  const editorRef = useRef<Editor | null>(null);
  const [mode, setMode] = useState<EditorMode>(() =>
    window.matchMedia("(max-width: 600px)").matches ? "mobile" : "full",
  );
  const [threadId, setThreadId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const { data: comments = [] } = useQuery<CommentReply[]>({
    queryKey: ["comments", document.id, threadId],
    queryFn: () => getCommentThread(document.id, threadId!),
    enabled: Boolean(threadId),
  });

  // placeholder 让首屏立即有内容；只有尚未编辑且服务器数据确实更新（revision 更高）时，
  // 才用真实服务器文档替换正文，避免 fetch 失败回退的旧种子数据覆盖已保存的编辑。
  useEffect(() => {
    if (generation !== 0) return;
    if (data.revision <= document.revision) return;
    setDocument(data);
    contentRef.current = data.content;
    generationRef.current = 0;
    setContent(data.content);
  }, [data, generation, document.revision]);
  const autosave = useAutosave({
    document,
    content,
    generation,
    onSaved: (next) => {
      setDocument((current) => ({
        ...current,
        content: next.content,
        revision: next.revision,
        savedAt: next.savedAt,
        storage: next.storage ?? current.storage ?? "server",
      }));
      queryClient.setQueryData<DocumentEnvelope>(["document", next.id], next);
      void queryClient.invalidateQueries({
        queryKey: ["revisions", next.id],
      });
    },
  });
  // Tiptap 初始化时可能规范化 JSON；服务器查询完成前忽略这类非用户更新，避免错误 baseRevision。
  const updateContent = (next: RichTextNode) => {
    if (isPlaceholderData) return;
    contentRef.current = next;
    generationRef.current += 1;
    setContent(next);
    setGeneration(generationRef.current);
  };
  // 回滚响应已经是一个新 revision；编辑器通过受控 content 同步显示该快照。
  const rollback = async (revision: number) => {
    try {
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
      setNotice(`已回退到版本 ${revision}，并创建版本 ${next.revision}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "版本回退失败");
    }
  };
  // 显式发布先 flush，保证提示出现时最新正文已经进入保存队列。
  const publish = async (latestContent?: RichTextNode) => {
    if (isPlaceholderData) return;
    const contentToSave = latestContent ??
      (editorRef.current?.getJSON() as RichTextNode | undefined);
    if (
      contentToSave &&
      JSON.stringify(contentToSave) !== JSON.stringify(contentRef.current)
    ) {
      contentRef.current = contentToSave;
      generationRef.current += 1;
      setContent(contentToSave);
      setGeneration(generationRef.current);
    }
    await autosave.flush(contentRef.current, generationRef.current);
    setNotice(
      mode === "compact"
        ? "回复已进入演示发布队列"
        : "正文已保存，可切换到阅读视图检查",
    );
  };

  const editor = (
    <RichTextEditor
      content={content}
      mode={mode}
      editable={!isPlaceholderData}
      onChange={updateContent}
      onSubmit={(latestContent) => void publish(latestContent)}
      onReady={(editorInstance) => {
        editorRef.current = editorInstance;
      }}
      onExpand={() => setMode("full")}
      onModeToolsOpen={() => setMode("full")}
      onCommentAnchorOpen={setThreadId}
    />
  );
  return (
    <main className="app-main">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
        <div>
          <h1 className="text-base font-bold">发帖与创作工作台</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {mode === "compact"
              ? "快速回复"
              : mode === "mobile"
                ? "移动编辑"
                : "完整创作"}{" "}
            · {identity.name}
          </p>
        </div>
        <Segmented
          value={mode}
          onChange={setMode}
          ariaLabel="编辑器布局"
          options={[
            {
              value: "compact",
              label: "极简",
              icon: <MessageCircle size={14} />,
            },
            { value: "full", label: "完整", icon: <Monitor size={14} /> },
            { value: "mobile", label: "移动", icon: <Smartphone size={14} /> },
          ]}
        />
      </div>
      {(autosave.state === "conflict" ||
        (autosave.state === "error" && autosave.conflictMessage)) && (
        <div
          className={cn(
            "mb-3 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-xs",
            autosave.state === "conflict"
              ? "border-[#e5b75e] bg-[#fff9eb] text-[#72500f]"
              : "border-[#f0b4b0] bg-[#fdf1f0] text-[#8f2b24]",
          )}
        >
          <AlertTriangle size={16} />
          <span className="min-w-[220px] flex-1">
            {autosave.conflictMessage}
          </span>
          {autosave.state === "error" ? (
            <span className="whitespace-nowrap">
              当前身份：{identity.name}（仅作者或版主可保存，请切换身份后重试）
            </span>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  navigator.clipboard.writeText(
                    JSON.stringify(content, null, 2),
                  )
                }
              >
                复制本地副本
              </Button>
              <Button size="sm" onClick={() => window.location.reload()}>
                加载最新版
              </Button>
            </>
          )}
        </div>
      )}
      {notice && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-[#add4cb] bg-[#edf8f5] px-3 py-2 text-xs text-[#185f57]">
          <Check size={15} />
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice("")}
            aria-label="关闭提示"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {mode === "full" ? (
        <div className="editor-workspace">
          <ChapterRail />
          <section className="editor-column">
            <div className="document-bar surface mb-2">
              <div className="min-w-0">
                <p className="document-title">{document.title}</p>
                <SaveStatus
                  state={isPlaceholderData ? "loading" : autosave.state}
                  revision={autosave.revision}
                  savedAt={autosave.savedAt}
                />
              </div>
              <Button
                size="sm"
                disabled={isPlaceholderData}
                onClick={() => void publish()}
              >
                <Save size={14} />
                保存
              </Button>
            </div>
            {editor}
          </section>
          <DemoBusinessPanel
            identity={identity}
            documentId={document.id}
            onRestore={(revision) => void rollback(revision)}
          />
        </div>
      ) : (
        <section>
          <div className="mx-auto mb-2 flex max-w-[860px] items-center justify-between px-1">
            <SaveStatus
              state={isPlaceholderData ? "loading" : autosave.state}
              revision={autosave.revision}
              savedAt={autosave.savedAt}
            />
            {mode === "compact" && (
              <Button variant="ghost" size="sm" onClick={() => setMode("full")}>
                <Maximize2 size={14} />
                展开
              </Button>
            )}
          </div>
          {editor}
        </section>
      )}
      <Dialog
        open={threadId !== null}
        onOpenChange={(open) => {
          if (!open) setThreadId(null);
        }}
        title="段落间贴"
        description="回复树按赞数排序，可折叠、回复和撤销赞踩。"
        className="max-w-2xl"
      >
        <CommentThread identity={identity} initial={comments} compact />
      </Dialog>
    </main>
  );
}
