import { Button, Dialog } from "../../components/ui";

export interface ChapterUploadDiff {
  total: number;
  toUpdate: number;
  added: number;
  modified: number;
  gaps: number;
  rows: Array<{
    id: string;
    title: string;
    status: "新增" | "修改" | "未变化";
  }>;
}

export function ChapterUploadDialog({
  open,
  diff,
  uploading,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  diff: ChapterUploadDiff | null;
  uploading: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="确定并分章上传"
      description="每个章节作为一个独立内容上传到服务器。"
      className="max-w-2xl"
    >
      {diff ? (
        <div className="space-y-3">
          {diff.gaps > 0 ? (
            <div className="rounded-md border border-[#f0b4b0] bg-[#fdf1f0] px-3 py-2 text-xs text-[#8f2b24]">
              本地核对发现仍有 <strong>{diff.gaps}</strong>{" "}
              段文字未切分进任何章节，建议先核对并处理再上传。
            </div>
          ) : (
            <div className="rounded-md border border-[#add4cb] bg-[#edf8f5] px-3 py-2 text-xs text-[#185f57]">
              本地核对通过：全部原文已连续切分进章节，无未切分段落。
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            本地共 <strong>{diff.total}</strong> 个章节，本次上传{" "}
            <strong>{diff.toUpdate}</strong> 个（新增 {diff.added}，修改{" "}
            {diff.modified}）。未变化的章节不会重复上传。
          </p>
          <div className="max-h-64 overflow-auto rounded-md border p-2">
            {diff.rows.map((row, index) => (
              <div
                key={row.id || index}
                className="flex items-center justify-between gap-2 border-b py-1 text-xs last:border-b-0"
              >
                <span className="truncate">
                  {index + 1}. {row.title}
                </span>
                <span
                  className={
                    row.status === "未变化"
                      ? "text-muted-foreground"
                      : "text-[#176e66]"
                  }
                >
                  {row.status}
                </span>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={uploading}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button size="sm" disabled={uploading} onClick={onConfirm}>
              {uploading ? "上传中…" : "确认分章上传"}
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
