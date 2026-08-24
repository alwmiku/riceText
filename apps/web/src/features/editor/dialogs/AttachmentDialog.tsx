import { useEffect, useState } from "react";
import { Button, Dialog } from "../../../components/ui";

/** 新增或编辑附件引用：可修改文件名、类型、大小和金币价格。 */
export function AttachmentDialog({
  open,
  onOpenChange,
  onInsert,
  initial,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onInsert: (values: {
    name: string;
    mimeType: string;
    size: number;
    priceCoins: number;
  }) => void;
  initial?: {
    name: string;
    mimeType: string;
    size: number;
    priceCoins: number;
  };
}) {
  const [name, setName] = useState("");
  const [mimeType, setMimeType] = useState("application/octet-stream");
  const [size, setSize] = useState(0);
  const [priceCoins, setPriceCoins] = useState(0);
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setMimeType(initial?.mimeType ?? "application/octet-stream");
    setSize(initial?.size ?? 0);
    setPriceCoins(initial?.priceCoins ?? 0);
  }, [open, initial]);
  const editing = Boolean(initial);
  const valid =
    name.trim().length > 0 &&
    Number.isFinite(size) &&
    Number.isFinite(priceCoins) &&
    size >= 0 &&
    priceCoins >= 0;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "编辑附件" : "插入附件"}
      description="设置附件显示信息与购买价格。"
      className="max-w-md"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              onInsert({
                name: name.trim(),
                mimeType: mimeType.trim() || "application/octet-stream",
                size: Math.max(0, Math.round(size)),
                priceCoins: Math.max(0, Math.round(priceCoins)),
              });
              onOpenChange(false);
            }}
          >
            {editing ? "保存修改" : "插入附件"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <label className="grid gap-1.5 text-xs font-semibold">
          文件名
          <input
            className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如 设定集.zip"
            autoFocus
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-xs font-semibold">
            MIME 类型
            <input
              className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
              value={mimeType}
              onChange={(event) => setMimeType(event.target.value)}
              placeholder="application/zip"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold">
            大小（字节）
            <input
              className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
              type="number"
              min="0"
              value={Number.isFinite(size) ? size : 0}
              onChange={(event) => setSize(Number(event.target.value))}
            />
          </label>
        </div>
        <label className="grid gap-1.5 text-xs font-semibold">
          价格（金币）
          <input
            className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
            type="number"
            min="0"
            value={Number.isFinite(priceCoins) ? priceCoins : 0}
            onChange={(event) => setPriceCoins(Number(event.target.value))}
          />
        </label>
      </div>
    </Dialog>
  );
}
