import { FilePlus2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, Dialog } from "../../components/ui";
import { Input } from "../../components/ui/input";
import type { DocumentListItem } from "@ricetext/contracts";

/** 紧凑文章选择器；原生 select 保持键盘和移动端选择体验。 */
export function ArticleSelector({
  articles,
  value,
  canCreate,
  disabled,
  onChange,
  onCreate,
  open,
  onOpenChange,
}: {
  articles: readonly DocumentListItem[];
  value: string;
  canCreate: boolean;
  disabled?: boolean;
  onChange: (id: string) => void;
  onCreate: (title: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const dialogOpen = open ?? internalOpen;
  const setDialogOpen = onOpenChange ?? setInternalOpen;
  const [title, setTitle] = useState("");
  const normalizedTitle = title.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!normalizedTitle) return;
    onCreate(normalizedTitle);
    setTitle("");
    setDialogOpen(false);
  };
  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
      <label className="sr-only" htmlFor="article-selector">选择文章</label>
      <select
        id="article-selector"
        aria-label="选择文章"
        value={articles.some((item) => item.id === value) ? value : ""}
        disabled={disabled || articles.length === 0}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 min-w-0 max-w-64 rounded-md border border-input bg-background px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {articles.length === 0 ? <option value="">暂无服务器文章</option> : null}
        {articles.map((article) => (
          <option key={article.id} value={article.id}>
            {article.title}
          </option>
        ))}
      </select>
      {canCreate ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => setDialogOpen(true)}
        >
          <FilePlus2 data-icon="inline-start" />
          新文章
        </Button>
      ) : null}
      </div>
      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="新建文章"
        description="文章先保存在本地，第一次点击保存后上传服务器。"
        footer={
          <>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button type="submit" form="create-article-form" disabled={!normalizedTitle}>
              <FilePlus2 data-icon="inline-start" />
              创建
            </Button>
          </>
        }
      >
        <form id="create-article-form" onSubmit={submit}>
          <label htmlFor="new-article-title" className="mb-2 block text-sm font-semibold">
            文章名称
          </label>
          <Input
            id="new-article-title"
            value={title}
            maxLength={200}
            autoFocus
            placeholder="输入文章名称"
            onChange={(event) => setTitle(event.target.value)}
          />
        </form>
      </Dialog>
    </>
  );
}
