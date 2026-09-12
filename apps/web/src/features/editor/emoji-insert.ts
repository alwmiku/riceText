import type { Editor } from "@tiptap/react";
import { emojiAssetPath, hasEmojiAsset, type EmojiCatalogEntry } from "@ricetext/contracts";
import type { EmojiAttributes } from "@ricetext/editor-core";
import { persistRecentEmojiId } from "../../components/ui/emoji-picker";

/** 把目录条目转成持久化的 `emoji` 节点属性。 */
export function emojiNodeAttributes(entry: EmojiCatalogEntry): EmojiAttributes | null {
  const src = emojiAssetPath(entry.id);
  if (!src) return null;
  return {
    emojiId: entry.id,
    name: entry.name,
    src,
    fallback: entry.text,
  };
}

/**
 * 在光标处插入一个表情：
 * - 自定义表情包写入 `emoji` 原子节点（图片由 /api/emoji/:id/image 提供）；
 * - Unicode 表情与颜文字写入普通 `text` 节点。
 *
 * 只读编辑器返回 `false` 且不产生事务；插入成功后记录「最近使用」。
 */
export function insertEmojiEntry(editor: Editor, entry: EmojiCatalogEntry): boolean {
  if (!editor.isEditable) return false;
  const attributes = emojiNodeAttributes(entry);
  const inserted = attributes
    ? editor.chain().focus().insertEmoji(attributes).run()
    : editor.chain().focus().insertContent(entry.text).run();
  if (inserted) persistRecentEmojiId(entry.id);
  return inserted;
}

/** 该条目走哪条插入路径；供工具栏在渲染期决定提示文案。 */
export function usesEmojiAsset(entry: EmojiCatalogEntry): boolean {
  return hasEmojiAsset(entry.id);
}
