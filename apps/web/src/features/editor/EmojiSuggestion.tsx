import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { EmojiTriggerState, EmojiStorage } from "@ricetext/editor-core";
import { EmojiGlyph } from "../../components/ui/emoji-glyph";

/** 空状态：浮层未打开时只保留这一个常量，避免每次渲染都新建对象。 */
const CLOSED: EmojiTriggerState = {
  open: false,
  query: "",
  from: 0,
  to: 0,
  items: [],
  activeIndex: 0,
};

/**
 * 读取 `emoji` 扩展的 storage；未注册该扩展时返回 undefined。
 * 必须读 `extensionStorage`：`editor.storage` 每次访问都会重新组装新对象，
 * 往它上面写 onTrigger 不会传回扩展内部。
 */
function emojiStorage(editor: Editor | null): EmojiStorage | undefined {
  if (!editor) return undefined;
  return (editor.extensionStorage as unknown as { emoji?: EmojiStorage }).emoji;
}

/** 把光标坐标换算成浮层位置，并夹在视口内避免被裁掉。 */
function positionFor(editor: Editor, from: number): { left: number; top: number } {
  try {
    const coords = editor.view.coordsAtPos(from);
    return {
      left: Math.min(Math.max(coords.left, 8), Math.max(window.innerWidth - 258, 8)),
      top: Math.min(Math.max(coords.bottom + 6, 8), Math.max(window.innerHeight - 260, 8)),
    };
  } catch {
    // jsdom 或选区已被销毁时坐标不可用：退化成视口居中，键盘操作仍可用。
    return { left: Math.max(window.innerWidth / 2 - 125, 8), top: 96 };
  }
}

/**
 * 输入 `hh` 或 `:` 触发的表情候选浮层。
 *
 * 状态完全来自 editor-core 的触发器插件（`storage.emoji.onTrigger`）：
 * 插件负责识别前缀、过滤候选与键盘上下移动，本组件只负责渲染与点击回填。
 * 卸载时把回调置回 `null`，避免宿主重建后仍收到陈旧状态。
 */
export function EmojiSuggestion({ editor }: { editor: Editor | null }) {
  const [state, setState] = useState<EmojiTriggerState>(CLOSED);

  useEffect(() => {
    const storage = emojiStorage(editor);
    if (!storage) return undefined;
    storage.onTrigger = (next) => setState(next);
    return () => {
      storage.onTrigger = null;
      setState(CLOSED);
    };
  }, [editor]);

  if (!editor || !state.open || state.items.length === 0) return null;
  const position = positionFor(editor, state.from);

  return (
    <div
      className="rt-emoji-suggest"
      role="listbox"
      aria-label="表情候选"
      style={{ left: position.left, top: position.top }}
    >
      {state.items.map((entry, index) => (
        <button
          key={entry.id}
          type="button"
          role="option"
          aria-selected={index === state.activeIndex}
          data-active={index === state.activeIndex}
          className="rt-emoji-suggest__item"
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => {
            // 悬停与键盘共用插件里的同一份高亮状态，避免两套高亮互相打架。
            emojiStorage(editor)?.setActiveIndex(index);
          }}
          onClick={() => {
            const storage = emojiStorage(editor);
            storage?.applyPick(entry.id);
          }}
        >
          <span className="rt-emoji-suggest__glyph">
            <EmojiGlyph entry={entry} size={20} />
          </span>
          <span className="rt-emoji-suggest__name">{entry.name}</span>
          {entry.shortcodes?.[0] ? (
            <span className="rt-emoji-suggest__hint">:{entry.shortcodes[0]}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
