import { MAX_CHAPTER_LENGTH } from "@ricetext/editor-core";
import { useEffect, useState } from "react";
import { Button, Dialog } from "../../components/ui";

export function AddChapterDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (title: string, text: string) => boolean;
}) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  useEffect(() => {
    if (!open) {
      setTitle("");
      setText("");
    }
  }, [open]);

  const submit = () => {
    if (!onSubmit(title, text)) return;
    onOpenChange(false);
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
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" onClick={submit}>
            添加并编辑
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
