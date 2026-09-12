import { useMemo, useState } from "react";
import {
  CUSTOM_EMOJI_ENTRIES,
  EMOJI_GROUPS,
  emojiEntriesByGroup,
  findEmojiEntry,
  searchEmojiEntries,
  type EmojiCatalogEntry,
} from "@ricetext/contracts";
import { EmojiGlyph } from "./emoji-glyph";

/** 最近使用表情的 localStorage 键；与拾色器的工作色一样按站点维度记忆。 */
const RECENT_EMOJI_KEY = "ricetext:recent-emoji";

/** 最近使用列表上限；超过后丢弃最旧的条目。 */
export const MAX_RECENT_EMOJI = 16;

/** 面板里排在分组页签最前面的「最近」页签 ID。 */
export const RECENT_GROUP_ID = "recent";

/** 读取最近使用的表情 id；数据损坏或不可用时静默返回空列表。 */
export function loadRecentEmojiIds(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_EMOJI_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .filter((item, index, all) => all.indexOf(item) === index)
      .slice(0, MAX_RECENT_EMOJI);
  } catch {
    return [];
  }
}

/** 记录一次使用：最近用的排在前面，写入失败（隐私模式/配额）时静默降级。 */
export function persistRecentEmojiId(emojiId: string): void {
  const next = [emojiId, ...loadRecentEmojiIds().filter((item) => item !== emojiId)].slice(
    0,
    MAX_RECENT_EMOJI,
  );
  try {
    window.localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(next));
  } catch {
    // 仅内存记忆即可，不影响插入本身。
  }
}

/**
 * 按当前页签与查询词解析要展示的条目：
 * - 有查询词时全目录搜索（跨分组），与分类页签无关；
 * - 「最近」页签只列最近使用过的、且仍在目录里的条目；
 * - 其余页签列该分组的全部条目。
 */
export function resolvePickerEntries(
  groupId: string,
  query: string,
  recentIds: readonly string[],
): readonly EmojiCatalogEntry[] {
  const needle = query.trim();
  if (needle) return searchEmojiEntries(needle, 240);
  if (groupId === RECENT_GROUP_ID) {
    return recentIds
      .map((id) => findEmojiEntry(id))
      .filter((entry): entry is EmojiCatalogEntry => entry !== undefined);
  }
  return emojiEntriesByGroup(groupId);
}

/** 默认选中页签：站点有自定义表情时优先展示，否则用第一个分组。 */
function defaultGroupId(): string {
  return CUSTOM_EMOJI_ENTRIES.length > 0 ? "custom" : (EMOJI_GROUPS[0]?.id ?? "faces");
}

/** 站点表情面板：搜索、分组页签与表情网格。插入动作由调用方通过 `onPick` 处理。 */
export function EmojiPicker({
  onPick,
  initialGroupId,
}: {
  onPick: (entry: EmojiCatalogEntry) => void;
  /** 打开面板时的默认页签；默认展示站点自定义表情。 */
  initialGroupId?: string;
}) {
  const [groupId, setGroupId] = useState(() => initialGroupId ?? defaultGroupId());
  const [query, setQuery] = useState("");
  const [recentIds, setRecentIds] = useState<string[]>(loadRecentEmojiIds);

  const entries = useMemo(
    () => resolvePickerEntries(groupId, query, recentIds),
    [groupId, query, recentIds],
  );

  const tabs = [
    { id: RECENT_GROUP_ID, label: "最近" },
    ...EMOJI_GROUPS.map((group) => ({ id: group.id, label: group.label })),
  ];

  const pick = (entry: EmojiCatalogEntry) => {
    persistRecentEmojiId(entry.id);
    setRecentIds(loadRecentEmojiIds());
    onPick(entry);
  };

  return (
    <div className="rt-emoji-picker" role="group" aria-label="表情选择器">
      <input
        className="rt-emoji-picker__search"
        type="search"
        aria-label="搜索表情"
        placeholder="搜索表情或拼音首字母"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // 编辑器宿主可能把它挂在下拉菜单里，避免菜单的类型查找拦截输入。
          if (event.key !== "Tab" && event.key !== "Escape" && event.key !== "Enter") {
            event.stopPropagation();
          }
        }}
      />
      <div className="rt-emoji-picker__tabs" role="tablist" aria-label="表情分组">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="rt-emoji-picker__tab"
            aria-selected={groupId === tab.id}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setGroupId(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {entries.length === 0 ? (
        <p className="rt-emoji-picker__empty" role="status">
          没有匹配的表情
        </p>
      ) : (
        <div className="rt-emoji-picker__grid" role="listbox" aria-label="表情列表">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="option"
              aria-selected={false}
              aria-label={entry.name}
              title={entry.name}
              className="rt-emoji-picker__item"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(entry)}
            >
              <EmojiGlyph entry={entry} size={22} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
