import type { Editor } from "@tiptap/react";
import { createId } from "../../lib/utils";

/**
 * 共享命令层：工具栏、选区浮动工具栏、右键菜单与折叠菜单
 * 都通过这里的纯命令函数驱动编辑器，避免各处重复实现。
 */

export function undo(editor: Editor): boolean {
  return editor.chain().focus().undo().run();
}

export function redo(editor: Editor): boolean {
  return editor.chain().focus().redo().run();
}

export function selectAll(editor: Editor): boolean {
  return editor.chain().focus().selectAll().run();
}

/** 复制当前选区文本到剪贴板；没有选区或剪贴板不可用时返回 false。 */
export async function copySelection(editor: Editor): Promise<boolean> {
  const { from, to } = editor.state.selection;
  if (from === to) return false;
  const text = editor.state.doc.textBetween(from, to, "\n\n", " ");
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 把剪贴板文本插入当前选区；多行按段落插入，不把文本当 HTML 解析。 */
export async function pasteSelection(editor: Editor): Promise<boolean> {
  const text = await navigator.clipboard.readText().catch(() => "");
  if (!text) return false;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const { selection } = editor.state;
  // 只有光标/选区落在同一个文本块内才插入行内文本，跨块或全选时按段落插入，
  // 避免把裸文本节点塞进文档层级导致插入被拒绝。
  const inline =
    lines.length === 1 &&
    selection.$from.parent.isTextblock &&
    (selection.empty || selection.$from.sameParent(selection.$to));
  const content = inline
    ? [{ type: "text", text }]
    : lines.map((line) =>
        line
          ? { type: "paragraph", content: [{ type: "text", text: line }] }
          : { type: "paragraph" },
      );
  try {
    return editor.chain().focus().insertContent(content).run();
  } catch {
    return false;
  }
}

export function toggleBold(editor: Editor): boolean {
  return editor.chain().focus().toggleBold().run();
}

export function toggleItalic(editor: Editor): boolean {
  return editor.chain().focus().toggleItalic().run();
}

export function toggleUnderline(editor: Editor): boolean {
  return editor.chain().focus().toggleUnderline().run();
}

export function toggleSpoiler(editor: Editor): boolean {
  return editor.chain().focus().toggleSpoiler().run();
}

export function toggleHeading(editor: Editor, level: 1 | 2): boolean {
  return editor.chain().focus().toggleHeading({ level }).run();
}

/** 清除样式：去掉全部行内 mark 与块级 node 格式。 */
export function clearFormatting(editor: Editor): boolean {
  return editor
    .chain()
    .focus()
    .unsetAllMarks()
    .resetAttributes("paragraph", ["firstLineIndent", "leftIndent"])
    .resetAttributes("heading", ["firstLineIndent", "leftIndent"])
    .clearNodes()
    .run();
}

export function toggleBulletList(editor: Editor): boolean {
  return editor.chain().focus().toggleBulletList().run();
}

export function toggleOrderedList(editor: Editor): boolean {
  return editor.chain().focus().toggleOrderedList().run();
}

export function toggleBlockquote(editor: Editor): boolean {
  return editor.chain().focus().toggleBlockquote().run();
}

export function setTextAlign(editor: Editor, align: "left" | "center" | "right"): boolean {
  return editor.chain().focus().setTextAlign(align).run();
}

export function setColor(editor: Editor, color: string): boolean {
  return editor.chain().focus().setColor(color).run();
}

/** 设置选区字号；基于当前 textStyle 属性增量更新。 */
export function setFontSize(editor: Editor, fontSize: string): boolean {
  return editor
    .chain()
    .focus()
    .setMark("textStyle", {
      ...editor.getAttributes("textStyle"),
      fontSize,
    })
    .run();
}

/** 设置选区字体；空值表示恢复默认字体。 */
export function setFontFamily(editor: Editor, fontFamily: string): boolean {
  return fontFamily
    ? editor.chain().focus().setFontFamily(fontFamily).run()
    : editor.chain().focus().unsetFontFamily().run();
}

/** 在光标处插入任意 JSON 节点并聚焦。 */
export function insertNode(editor: Editor, node: Record<string, unknown>): boolean {
  return editor.chain().focus().insertContent(node).run();
}

/** 插入间贴锚点（评论线程起点）。 */
export function insertCommentAnchor(editor: Editor): boolean {
  return insertNode(editor, {
    type: "inlineCommentAnchor",
    attrs: { threadId: createId("thread"), count: 0, placement: "end" },
  });
}

/** 插入回复后可见容器（默认占位提示文案）。 */
export function insertReplyGate(editor: Editor): boolean {
  return insertNode(editor, {
    type: "replyGate",
    attrs: { gateId: createId("gate"), prompt: "回复后可见" },
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "在这里编辑回复后可见的内容" }],
      },
    ],
  });
}
