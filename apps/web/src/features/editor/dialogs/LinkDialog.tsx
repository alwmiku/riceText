import { useEffect, useState } from "react";
import { Button, Dialog } from "../../../components/ui";

const LINK_PATTERN = /^https?:\/\//i;

/**
 * 新增/替换链接输入对话框。
 *
 * 移动端（Android Chrome）不支持 window.prompt，旧的 prompt 流程在移动端
 * 静默返回 null 导致无法插入链接；这里改用应用内 Dialog，桌面与移动端共用。
 */
export function LinkDialog({
  open,
  onOpenChange,
  onInsert,
  initialHref,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  /** 校验通过后携带纯文本地址回调；调用方负责套用到选区。 */
  onInsert: (href: string) => void;
  /** 选区上已有链接时的初始地址。 */
  initialHref?: string;
  /** 选区上已有链接时提供「移除链接」入口。 */
  onRemove?: () => void;
}) {
  const [href, setHref] = useState("");
  useEffect(() => {
    if (!open) return;
    setHref(initialHref ?? "https://");
  }, [open, initialHref]);
  const trimmed = href.trim();
  const valid = LINK_PATTERN.test(trimmed);
  const submit = () => {
    if (!valid) return;
    onInsert(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={onRemove ? "编辑链接" : "插入链接"}
      description="输入以 http:// 或 https:// 开头的网址，应用到选中的文字。"
      className="max-w-md"
      footer={
        <>
          {onRemove ? (
            <Button
              variant="outline"
              className="mr-auto"
              onClick={() => {
                onRemove();
                onOpenChange(false);
              }}
            >
              移除链接
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={!valid} onClick={submit}>
            {onRemove ? "保存修改" : "插入链接"}
          </Button>
        </>
      }
    >
      <label className="grid gap-1.5 text-xs font-semibold">
        链接地址
        <input
          className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
          value={href}
          onChange={(event) => setHref(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && valid) submit();
          }}
          placeholder="https://example.com"
          inputMode="url"
          enterKeyHint="done"
          autoFocus
        />
      </label>
      {!valid && href.length > 0 ? (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          仅允许 HTTP(S) 链接
        </p>
      ) : null}
    </Dialog>
  );
}
