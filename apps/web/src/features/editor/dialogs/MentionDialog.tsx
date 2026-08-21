import { useEffect, useState } from "react";
import { AtSign, LoaderCircle } from "lucide-react";
import { Dialog } from "../../../components/ui";
import { identities } from "../../../lib/seed";

/** 好友即时搜索与非好友待解析 mention 的演示选择器。 */
export function MentionDialog({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onInsert: (user: {
    id: string;
    name: string;
    resolved: boolean;
    avatarUrl: string | null;
  }) => void;
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  // 260ms 延迟模拟真实好友/用户搜索的 debounce 与 loading 状态。
  useEffect(() => {
    if (!query) return;
    setSearching(true);
    const timer = window.setTimeout(() => setSearching(false), 260);
    return () => window.clearTimeout(timer);
  }, [query]);
  const friends = identities.filter(
    (identity) => identity.name.includes(query) || identity.id.includes(query),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="提及用户"
      description="好友即时匹配；非好友会在发往服务器后解析。"
      className="max-w-md"
    >
      <div className="relative">
        <AtSign
          className="absolute left-3 top-3 text-muted-foreground"
          size={16}
        />
        <input
          className="field pl-9"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="按名字或 ID 搜索"
          autoFocus
        />
      </div>
      <div className="mt-3 min-h-32 space-y-1">
        {searching ? (
          <div className="grid h-24 place-items-center">
            <LoaderCircle size={18} className="animate-spin text-primary" />
          </div>
        ) : (
          friends.map((user) => (
            <button
              type="button"
              key={user.id}
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted"
              onClick={() => {
                onInsert({
                  id: user.id,
                  name: user.name,
                  resolved: true,
                  avatarUrl: null,
                });
                onOpenChange(false);
              }}
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-xs font-bold text-white">
                {user.avatar}
              </span>
              <span>
                <strong className="block text-sm">{user.name}</strong>
                <small className="text-muted-foreground">
                  {user.id} · 好友
                </small>
              </span>
            </button>
          ))
        )}
        {query && !searching && friends.length === 0 && (
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-md px-2 py-3 text-left hover:bg-muted"
            onClick={() => {
              onInsert({
                id: query,
                name: query,
                resolved: false,
                avatarUrl: null,
              });
              onOpenChange(false);
            }}
          >
            <span className="grid h-8 w-8 place-items-center rounded-full bg-muted">
              <AtSign size={15} />
            </span>
            <span>
              <strong className="block text-sm">@{query}</strong>
              <small className="text-muted-foreground">
                非好友 · 发布后由服务器确认
              </small>
            </span>
          </button>
        )}
      </div>
    </Dialog>
  );
}
