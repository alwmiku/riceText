import { Node, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { emojiNodeSpec, type EmojiAttributes } from "@ricetext/document-core";
import {
  DEFAULT_EMOJI_QUERY_LIMIT,
  emojiAssetPath,
  hasEmojiAsset,
  searchEmojiEntries,
  type EmojiCatalogEntry,
} from "@ricetext/contracts";

/** 触发浮层需要渲染的一份建议快照。 */
export interface EmojiTriggerState {
  /** 建议浮层是否应当可见。 */
  open: boolean;
  /** 已输入的前缀之后的查询词；空串表示展示默认候选。 */
  query: string;
  /** 被查询词覆盖的文档区间（触发前缀在 `from` 之前，不包含在内）。 */
  from: number;
  /** 同上，区间结束位置。 */
  to: number;
  /** 当前候选条目。 */
  items: readonly EmojiCatalogEntry[];
  /** 键盘高亮下标；始终落在 `items` 范围内或为 0。 */
  activeIndex: number;
}

/**
 * `emoji` 扩展的 storage 形状：宿主通过它渲染候选浮层并回填选择。
 *
 * 注意 Tiptap 的 `storage` 是每次访问都会重新计算的 getter，扩展也不能从
 * `this` 上拿到 editor。因此这里只放"能被宿主替换的回调字段"，具体实现由
 * 插件闭包通过 {@link createTriggerHost} 绑定到真实的 EditorView。
 */
export interface EmojiStorage {
  /** 触发器状态变化回调；宿主挂载时赋值，卸载时置回 `null`。 */
  onTrigger: ((state: EmojiTriggerState) => void) | null;
  /** 宿主选中某个候选：替换当前查询区间并关闭浮层。 */
  applyPick: (emojiId: string) => boolean;
  /** 宿主用鼠标悬停移动高亮；浮层内不直接改插件状态。 */
  setActiveIndex: (index: number) => boolean;
}

/**
 * 取真正挂在编辑器上的 storage 对象。
 *
 * 注意不能读 `editor.storage.emoji`：`Editor.storage` 是 getter，每次访问都
 * 重新组装一个**新对象**，往上面挂方法不会影响 `extensionStorage`，
 * 宿主与命令拿到的仍是占位实现。
 */
function emojiStorageOf(editor: Editor): EmojiStorage | undefined {
  const storage = editor.extensionStorage as unknown as { emoji?: EmojiStorage } | undefined;
  return storage?.emoji;
}

/** 该 EditorView 上当前是否有一个打开的触发器浮层。 */
function triggerStateOf(view: EditorView): TriggerPluginState | null {
  return emojiTriggerKey.getState(view.state) ?? null;
}

/**
 * 宿主选中某个候选；失败（浮层已关、id 不在目录里）返回 `false`。
 * view 由插件闭包在运行期捕获，避免扩展从 `this` 上取 editor。
 */
function applyTriggerPick(view: EditorView | null, emojiId: string): boolean {
  const current = view ? triggerStateOf(view) : null;
  if (!view || !current) return false;
  const entry = searchEmojiEntries(emojiId, 1)[0];
  if (!entry || entry.id !== emojiId) return false;
  return insertFromTrigger(view, current, entry);
}

/** 宿主用鼠标悬停移动高亮；index 越界时返回 `false`。 */
function moveTriggerHighlight(view: EditorView | null, index: number): boolean {
  const current = view ? triggerStateOf(view) : null;
  if (!view || !current) return false;
  if (index < 0 || index >= current.items.length) return false;
  if (current.activeIndex === index) return true;
  const { tr } = view.state;
  tr.setMeta(emojiTriggerKey, { ...current, activeIndex: index });
  view.dispatch(tr);
  return true;
}

/** 触发器插件的内部状态。 */
interface TriggerPluginState extends TriggerMatch {
  items: readonly EmojiCatalogEntry[];
  activeIndex: number;
}

/** 折叠状态的插件键；同时用于读取当前触发器状态。 */
const emojiTriggerKey = new PluginKey<TriggerPluginState | null>("emojiTrigger");

/** 行首/空白之后的冒号才算触发前缀，避免打断中文冒号与 `12:30` 这类写法。 */
const COLON_PREFIX = /(^|[\s([{（【])$/u;

/** 在触发前缀之前的文本里截取查询词的最大长度。 */
const MAX_QUERY_LENGTH = 20;

/** 触发器解析结果。 */
interface TriggerMatch {
  /** 触发前缀（`hh` 或 `:`）的起始位置。 */
  prefixFrom: number;
  /** 前缀本身，空查询时用来筛候选。 */
  prefix: string;
  /** 查询词覆盖的区间。 */
  from: number;
  to: number;
  query: string;
}

/**
 * 从光标向前读取触发前缀与查询词；无匹配时返回 `null`。
 *
 * 查询区间始终是「光标前 query.length 个字符」——查询为空时它就退化成光标处的
 * 空区间，插入时只删除前缀本身，不会多删一个字符。
 */
function readTrigger(doc: ProseMirrorNode, cursor: number): TriggerMatch | null {
  const before = doc.textBetween(Math.max(0, cursor - MAX_QUERY_LENGTH), cursor, "\n", "\ufffc");
  const hh = /(?:^|[^\p{L}\p{N}])hh(?:([^\s]+))?$/u.exec(before);
  if (hh) {
    const query = hh[1] ?? "";
    return {
      prefixFrom: cursor - 2 - query.length,
      prefix: "hh",
      from: cursor - query.length,
      to: cursor,
      query,
    };
  }
  const colon = /:([^\s:]*)$/u.exec(before);
  if (colon && COLON_PREFIX.test(before.slice(0, colon.index))) {
    const query = colon[1] ?? "";
    return {
      prefixFrom: cursor - 1 - query.length,
      prefix: ":",
      from: cursor - query.length,
      to: cursor,
      query,
    };
  }
  return null;
}

/** 依据查询词解析候选；保留上一次的高亮条目以稳定键盘操作。 */
function resolveState(
  previous: TriggerPluginState | null,
  next: ReturnType<typeof readTrigger>,
): TriggerPluginState | null {
  if (!next) return null;
  // 还没输入查询词时按触发前缀筛选：`hh` 直接给出对应快捷码的表情，
  // 而不是把目录前几条塞给用户。
  const items = searchEmojiEntries(next.query || next.prefix, DEFAULT_EMOJI_QUERY_LIMIT);
  if (items.length === 0) return null;
  if (
    previous &&
    previous.prefixFrom === next.prefixFrom &&
    previous.from === next.from &&
    previous.to === next.to &&
    previous.query === next.query
  ) {
    return previous;
  }
  const previousId =
    previous && previous.items[previous.activeIndex]
      ? previous.items[previous.activeIndex]!.id
      : undefined;
  const matchedIndex = previousId ? items.findIndex((entry) => entry.id === previousId) : -1;
  const activeIndex = matchedIndex >= 0 ? matchedIndex : 0;
  // 语义未变化时复用旧对象：查看器/浮层据此判断「无需重渲染」，同时避免
  // appendTransaction 每次都返回一笔空事务。
  if (
    previous &&
    previous.prefixFrom === next.prefixFrom &&
    previous.from === next.from &&
    previous.to === next.to &&
    previous.query === next.query &&
    previous.activeIndex === activeIndex &&
    previous.items.length === items.length &&
    previous.items.every((entry, index) => entry.id === items[index]?.id)
  ) {
    return previous;
  }
  return { ...next, items, activeIndex };
}

/** 把候选条目写成 `emoji` 节点或纯文本。 */
function emojiContent(entry: EmojiCatalogEntry): Record<string, unknown> {
  const src = emojiAssetPath(entry.id);
  if (!src) return { type: "text", text: entry.text };
  const attrs: EmojiAttributes = {
    emojiId: entry.id,
    name: entry.name,
    src,
    fallback: entry.text,
  };
  return { type: "emoji", attrs };
}

/** 用候选条目替换触发器区间（`hh`/`:` 前缀与查询词一并删除）。 */
function insertFromTrigger(
  view: EditorView,
  state: TriggerPluginState,
  entry: EmojiCatalogEntry,
): boolean {
  const node = view.state.schema.nodeFromJSON(emojiContent(entry));
  const { tr } = view.state;
  tr.replaceWith(state.prefixFrom, state.to, node);
  tr.setMeta(emojiTriggerKey, null);
  view.dispatch(tr);
  return true;
}

/** Tiptap 命令拿到的状态与派发函数；命令必须经它派发，不能自行 view.dispatch。 */
interface CommandContext {
  state: EditorState;
  dispatch: ((tr: Transaction) => void) | undefined;
}

/**
 * 在当前选区插入内容并按 Tiptap 命令契约派发。
 *
 * 不使用 `chain().focus().insertContent()`：focus 会先派发一笔只改选区的事务，
 * 之后 insertContent 仍是基于旧状态构造事务，程序化调用时会抛出
 * 「Applying a mismatched transaction」。这里直接基于传入的 state 造事务。
 */
function insertContentAtSelection(
  { state, dispatch }: CommandContext,
  action: (tr: Transaction) => void,
): boolean {
  const { tr } = state;
  action(tr);
  tr.scrollIntoView();
  dispatch?.(tr);
  return true;
}

/** 在当前选区插入一个 `emoji` 节点。 */
function insertEmojiNodeAtSelection(context: CommandContext, attrs: EmojiAttributes): boolean {
  return insertContentAtSelection(context, (tr) => {
    tr.replaceSelectionWith(context.state.schema.nodeFromJSON({ type: "emoji", attrs }));
  });
}

/** 按目录 id 插入表情：自定义表情插入节点，纯文本表情插入字符。 */
function insertEmojiEntry(context: CommandContext, emojiId: string): boolean {
  const entry = searchEmojiEntries(emojiId, 1)[0];
  if (!entry || entry.id !== emojiId) return false;
  if (!hasEmojiAsset(entry.id)) {
    return insertContentAtSelection(context, (tr) => {
      tr.insertText(entry.text);
    });
  }
  const src = emojiAssetPath(entry.id);
  if (!src) return false;
  return insertEmojiNodeAtSelection(context, {
    emojiId: entry.id,
    name: entry.name,
    src,
    fallback: entry.text,
  });
}

/** 站点自定义表情包的行内原子节点（规格来自 document-core）。 */
export const Emoji = Node.create({
  ...emojiNodeSpec,
  addCommands() {
    return {
      insertEmoji: (attrs) => (props) => {
        // 先按命令契约派发事务，再把焦点交还编辑区（与文档无关的副作用）。
        const inserted = insertEmojiNodeAtSelection(props, attrs);
        if (inserted) props.view?.focus();
        return inserted;
      },
      insertEmojiFromQuery: (emojiId) => (props) => {
        const inserted = insertEmojiEntry(props, emojiId);
        if (inserted) props.view?.focus();
        return inserted;
      },
    };
  },
  addStorage(): EmojiStorage {
    // onTrigger 由宿主在挂载时写入；applyPick / setActiveIndex 在插件 view()
    // 里被替换成绑定到真实 EditorView 的实现。
    return {
      onTrigger: null,
      applyPick: () => false,
      setActiveIndex: () => false,
    };
  },
  addProseMirrorPlugins() {
    let currentView: EditorView | null = null;
    let extensionStorage: EmojiStorage | null = null;
    return [
      new Plugin<TriggerPluginState | null>({
        key: emojiTriggerKey,
        state: {
          init: () => null,
          apply: (transaction, previous) => {
            const meta = transaction.getMeta(emojiTriggerKey) as
              TriggerPluginState | null | undefined;
            if (meta === null) return null;
            const match = readTrigger(transaction.doc, transaction.selection.to);
            if (!match) return null;
            // 显式写入状态的事务（键盘上下移动、宿主悬停移动高亮）直接采信其
            // activeIndex：纯高亮事务不改文档，重新解析会命中"状态未变化"的
            // 复用分支而丢掉下标移动。
            if (meta) return { ...match, items: meta.items, activeIndex: meta.activeIndex };
            return resolveState(previous, match);
          },
        },
        appendTransaction: (transactions, _oldState, newState) => {
          const previous = emojiTriggerKey.getState(newState) ?? null;
          // 显式写入过触发器状态（打开/关闭/移动高亮）的事务不再重算，
          // 否则键盘上下移动高亮会被立刻重置回第一个候选。
          if (
            transactions.some((transaction) => transaction.getMeta(emojiTriggerKey) !== undefined)
          ) {
            return null;
          }
          const next = resolveState(previous, readTrigger(newState.doc, newState.selection.to));
          if (next === previous) return null;
          const { tr } = newState;
          tr.setMeta(emojiTriggerKey, next);
          tr.setMeta("addToHistory", false);
          return tr;
        },
        view: (view) => {
          currentView = view;
          // 把 storage 上的占位实现替换成绑定到本 view 的真实实现。
          try {
            const storage = emojiStorageOf(this.editor);
            if (storage) {
              extensionStorage = storage;
              storage.applyPick = (emojiId: string) => applyTriggerPick(currentView, emojiId);
              storage.setActiveIndex = (index: number) => moveTriggerHighlight(currentView, index);
            }
          } catch {
            // editor 尚未完成装配时退化为占位实现（调用方会拿到 false），不阻塞编辑器创建。
          }
          return {
            update: (nextView) => {
              // 每次视图更新都把最新状态推给宿主浮层：光标移动、外部编辑与
              // 关闭都会走到这里，宿主不需要再订阅编辑器事件。
              currentView = nextView;
              const current = triggerStateOf(nextView);
              extensionStorage?.onTrigger?.({
                open: current !== null,
                query: current?.query ?? "",
                from: current?.from ?? 0,
                to: current?.to ?? 0,
                items: current?.items ?? [],
                activeIndex: current?.activeIndex ?? 0,
              });
            },
            destroy: () => {
              currentView = null;
            },
          };
        },
        props: {
          handleKeyDown: (view, event) => {
            const current = emojiTriggerKey.getState(view.state);
            if (!current) return false;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              const delta = event.key === "ArrowDown" ? 1 : -1;
              const count = current.items.length;
              const activeIndex = (current.activeIndex + delta + count) % count;
              const { tr } = view.state;
              tr.setMeta(emojiTriggerKey, { ...current, activeIndex });
              view.dispatch(tr);
              return true;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              const entry = current.items[current.activeIndex];
              if (!entry) return false;
              return insertFromTrigger(view, current, entry);
            }
            if (event.key === "Escape") {
              const { tr } = view.state;
              tr.setMeta(emojiTriggerKey, null);
              view.dispatch(tr);
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
