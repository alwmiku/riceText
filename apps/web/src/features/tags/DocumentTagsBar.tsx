import {
  TAG_LABEL_MAX,
  TAG_LIMIT,
  normalizeTagLabel,
  tagSlug,
  type DocumentTag,
  type Tag,
} from "@ricetext/contracts";
import { Tag as TagIcon, X } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "../../components/ui";
import { Input } from "../../components/ui/input";
import { cn } from "../../lib/utils";
import { TAG_CHIP_BASE, tagChipClassName, tagChipStyle } from "./tag-colors";

/**
 * 编辑页底部的文章标签栏。
 *
 * 标签属于整篇文章（不是章节），因此这里不接触编辑器的正文与章节范围：
 * - 点「站点标签」或输入 `#`：从服务器字典里挑（chips 标为「服务器」）；
 * - 直接输入文本按 Enter：建成只属于这篇文章的作者标签（chips 标为「自建」）。
 * 组件只把「整篇文章的目标标签文本」交给调用方，来源解析由服务端按字典决定。
 */
export function DocumentTagsBar({
  tags,
  candidates,
  readOnly = false,
  readOnlyHint,
  saving = false,
  error,
  onChange,
}: {
  /** 当前已保存的标签，顺序即展示顺序。 */
  tags: readonly DocumentTag[];
  /** 站点标签候选；未加载完成时传空数组即可。 */
  candidates: readonly Tag[];
  /** 只读模式：无编辑权，或文章还没保存到服务器。 */
  readOnly?: boolean;
  /** 只读时展示的原因文案。 */
  readOnlyHint?: string | undefined;
  /** 保存中。 */
  saving?: boolean;
  /** 服务端返回的失败文案。 */
  error?: string | undefined;
  /** 提交整篇文章的标签文本（全量替换）。 */
  onChange: (labels: string[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [localError, setLocalError] = useState("");
  const full = tags.length >= TAG_LIMIT;

  // 候选：排除已选，按输入文本过滤；输入为空时就是「浏览全部站点标签」。
  const matches = useMemo(() => {
    if (full) return [];
    const query = (normalizeTagLabel(draft) ?? "").toLowerCase();
    const selected = new Set(tags.map((tag) => tag.slug));
    return candidates
      .filter((candidate) => !selected.has(candidate.slug))
      .filter((candidate) => !query || candidate.label.toLowerCase().includes(query))
      .slice(0, 8);
  }, [candidates, draft, full, tags]);

  const submit = (labels: readonly string[]) => {
    setDraft("");
    setOpen(false);
    setHighlight(0);
    onChange([...labels]);
  };

  const addCandidate = (candidate: Tag) => {
    if (tags.length >= TAG_LIMIT) {
      setLocalError(`一篇文章最多 ${TAG_LIMIT} 个标签`);
      return;
    }
    if (tags.some((tag) => tag.slug === candidate.slug)) return;
    setLocalError("");
    submit([...tags.map((tag) => tag.label), candidate.label]);
  };

  const commitDraft = () => {
    const label = normalizeTagLabel(draft);
    if (!label) {
      setLocalError(`标签需 1-${TAG_LABEL_MAX} 个字符，且不能只有标点`);
      return;
    }
    if (tags.some((tag) => tag.slug === tagSlug(label))) {
      // 已选过的标签重复输入直接吞掉，不报错也不重复添加。
      setDraft("");
      return;
    }
    if (tags.length >= TAG_LIMIT) {
      setLocalError(`一篇文章最多 ${TAG_LIMIT} 个标签`);
      return;
    }
    setLocalError("");
    submit([...tags.map((tag) => tag.label), label]);
  };

  const remove = (slug: string) => {
    setLocalError("");
    submit(tags.filter((tag) => tag.slug !== slug).map((tag) => tag.label));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (matches.length === 0) return;
      event.preventDefault();
      setOpen(true);
      setHighlight((current) => {
        const next = event.key === "ArrowDown" ? current + 1 : current - 1;
        return (next + matches.length) % matches.length;
      });
      return;
    }
    const candidate = open ? matches[highlight] : undefined;
    if (event.key === "Tab" && candidate) {
      event.preventDefault();
      addCandidate(candidate);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      // 以 # 开头并命中站点标签时 Enter 选取候选；其余情况按作者自建标签提交。
      const picksCandidate = draft.trimStart().startsWith("#") && candidate;
      if (picksCandidate) addCandidate(candidate);
      else commitDraft();
    }
  };

  const message = localError || error || "";

  return (
    <section
      className="rounded-lg border border-border bg-white p-3 shadow-panel"
      aria-label="文章标签"
    >
      <div className="flex flex-wrap items-center gap-2">
        <TagIcon size={14} className="text-[#176e66]" />
        <strong className="text-xs">文章标签</strong>
        <span className="text-[10px] text-muted-foreground">
          整篇文章 · {tags.length}/{TAG_LIMIT}
        </span>
        {saving ? (
          <span role="status" className="text-[10px] text-muted-foreground">
            保存中…
          </span>
        ) : null}
        {!readOnly && !full ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 px-2 text-[11px]"
            aria-label="浏览站点标签"
            disabled={saving}
            onClick={() => {
              setOpen(true);
              inputRef.current?.focus();
            }}
          >
            <TagIcon size={12} />
            站点标签
          </Button>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {tags.length === 0 ? (
          <span className="text-[11px] text-muted-foreground">还没有标签</span>
        ) : null}
        {tags.map((tag) => (
          <span
            key={tag.slug}
            data-source={tag.source}
            title={tag.source === "server" ? "站点标签" : "作者自建标签"}
            className={cn(TAG_CHIP_BASE, tagChipClassName(tag))}
            style={tagChipStyle(tag)}
          >
            {tag.label}
            {readOnly ? null : (
              <button
                type="button"
                aria-label={`移除标签 ${tag.label}`}
                disabled={saving}
                onClick={() => remove(tag.slug)}
                className="grid h-4 w-4 place-items-center rounded-full opacity-55 hover:bg-black/10 hover:opacity-100 disabled:opacity-45"
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}

        {readOnly ? null : full ? (
          <span className="text-[11px] text-muted-foreground">
            已达 {TAG_LIMIT} 个上限，删除后可以再加
          </span>
        ) : (
          <div className="relative min-w-[200px] flex-1">
            <Input
              ref={inputRef}
              value={draft}
              aria-label="输入新标签"
              placeholder="输入标签，或输入 # 选择站点标签"
              disabled={saving}
              className="h-7 text-xs"
              onChange={(event) => {
                setDraft(event.target.value);
                setLocalError("");
                setHighlight(0);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              onKeyDown={onKeyDown}
            />
            {open && matches.length > 0 ? (
              <ul
                role="listbox"
                aria-label="站点标签候选"
                className="absolute bottom-full left-0 z-50 mb-1 max-h-52 w-full overflow-auto rounded-md border border-border bg-white p-1 shadow-xl"
              >
                {matches.map((candidate, index) => (
                  <li
                    key={candidate.id}
                    role="option"
                    aria-selected={index === highlight}
                    className={cn(
                      "flex cursor-default items-center gap-2 rounded px-2 py-1 text-xs",
                      index === highlight ? "bg-muted" : "",
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => addCandidate(candidate)}
                  >
                    <span className="font-semibold">#{candidate.label}</span>
                    {candidate.description ? (
                      <span className="truncate text-[10px] text-muted-foreground">
                        {candidate.description}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </div>

      {message ? (
        <p role="alert" className="mt-2 text-[11px] text-destructive">
          {message}
        </p>
      ) : null}
      {readOnly && readOnlyHint ? (
        <p className="mt-2 text-[11px] text-muted-foreground">{readOnlyHint}</p>
      ) : null}
    </section>
  );
}
