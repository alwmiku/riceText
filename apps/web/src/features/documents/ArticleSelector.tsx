import { FilePlus2 } from "lucide-react";
import { Button } from "../../components/ui";
import type { DocumentListItem } from "@ricetext/contracts";

/** 紧凑文章选择器；原生 select 保持键盘和移动端选择体验。 */
export function ArticleSelector({
  articles,
  value,
  canCreate,
  disabled,
  onChange,
  onCreate,
}: {
  articles: readonly DocumentListItem[];
  value: string;
  canCreate: boolean;
  disabled?: boolean;
  onChange: (id: string) => void;
  onCreate: () => void;
}) {
  return (
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
            {article.title} · {article.id}{article.canEdit ? " · 可编辑" : " · 只读"}
          </option>
        ))}
      </select>
      {canCreate ? (
        <Button type="button" size="sm" variant="outline" onClick={onCreate}>
          <FilePlus2 data-icon="inline-start" />
          新文章
        </Button>
      ) : null}
    </div>
  );
}
