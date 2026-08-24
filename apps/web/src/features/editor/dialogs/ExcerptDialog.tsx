import { useState, type ChangeEvent } from "react";
import { Button, Dialog } from "../../../components/ui";

/** 收集可检索小说摘录的来源元数据、展示 preset 和正文。 */
export function ExcerptDialog({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onInsert: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState({
    bookTitle: "雾港来信",
    chapterTitle: "第三章",
    author: "林稻",
    sourceUrl: "",
    variant: "desktop-book",
    text: "",
  });
  const field = (key: keyof typeof values) => ({
    value: values[key],
    onChange: (
      event: ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => setValues((current) => ({ ...current, [key]: event.target.value })),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="插入小说摘录"
      description="使用可检索文字替代截图证据，并保留作品和章节来源。"
      className="max-w-xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={!values.text.trim()}
            onClick={() => {
              onInsert(values);
              onOpenChange(false);
            }}
          >
            插入摘录
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-xs font-semibold">
            书名
            <input className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15" {...field("bookTitle")} />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold">
            章节
            <input className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15" {...field("chapterTitle")} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-xs font-semibold">
            作者
            <input className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15" {...field("author")} />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold">
            排版
            <select className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15" {...field("variant")}>
              <option value="desktop-book">通用书站 · 桌面</option>
              <option value="mobile-book">通用书站 · 手机</option>
              <option value="forum-evidence">论坛证据</option>
            </select>
          </label>
        </div>
        <label className="grid gap-1.5 text-xs font-semibold">
          来源链接（可选）
          <input
            className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
            {...field("sourceUrl")}
            placeholder="https://example.com/chapter"
          />
        </label>
        <label className="grid gap-1.5 text-xs font-semibold">
          摘录正文
          <textarea className="h-auto min-h-36 w-full resize-y rounded-md border border-input bg-white px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15" {...field("text")} />
        </label>
      </div>
    </Dialog>
  );
}
