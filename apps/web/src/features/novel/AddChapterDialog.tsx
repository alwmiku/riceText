import { MAX_CHAPTER_LENGTH } from "@ricetext/editor-core";
import { useEffect, useState } from "react";
import { Button, Dialog } from "../../components/ui";

/** 自管理表单草稿的添加章节弹窗；领域层只接收校验后的提交结果。 */
export function AddChapterDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (title: string, text: string) => boolean | Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 弹窗关闭即丢弃未提交表单，重新打开时始终从空白状态开始。
  useEffect(() => {
    if (!open) {
      setTitle("");
      setText("");
      setSubmitting(false);
    }
  }, [open]);

  const submit = () => {
    const result = onSubmit(title, text);
    if (typeof result === "boolean") {
      if (result) onOpenChange(false);
      return;
    }
    setSubmitting(true);
    void result
      .then((accepted) => {
        if (accepted) onOpenChange(false);
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="添加章节"
      description="用于番外、作者说、短章等手动补充的内容。"
      className="max-w-2xl"
    >
      <div className="space-y-3">
        <label
          className="block text-xs font-medium"
          htmlFor="add-chapter-title"
        >
          章节标题
        </label>
        <input
          id="add-chapter-title"
          className="w-full rounded-md border px-3 py-2 text-sm"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="例如：番外 · 雨季来信"
        />
        <label className="block text-xs font-medium" htmlFor="add-chapter-text">
          正文（最多 {MAX_CHAPTER_LENGTH.toLocaleString()} 字）
        </label>
        <textarea
          id="add-chapter-text"
          className="h-40 w-full rounded-md border px-3 py-2 text-sm"
          value={text}
          maxLength={MAX_CHAPTER_LENGTH}
          onChange={(event) => setText(event.target.value)}
          placeholder="粘贴或输入章节内容…"
        />
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button size="sm" disabled={submitting} onClick={submit}>
            {submitting ? "正在添加…" : "添加并编辑"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
