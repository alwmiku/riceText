import type { Editor } from "@tiptap/react";
import { createId } from "../../lib/utils";
import { FONT_SIZE_RANGE } from "./editor-tool-definitions";

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

/** 与 Ctrl+C 共用选区序列化，同时复制 HTML 和纯文本；失败时不降级为丢格式的复制。 */
export async function copySelection(editor: Editor): Promise<boolean> {
  if (editor.isDestroyed || editor.state.selection.empty) return false;
  try {
    // 在权限请求前冻结选区，保留原生切片的上下文、段落属性和自定义节点。
    const { dom, text } = editor.view.serializeForClipboard(editor.state.selection.content());
    const html = dom.innerHTML;
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
    // 旧浏览器仍通过真实复制事件写入两种格式，不插入隐藏节点或修改正文。
    const document = editor.view.dom.ownerDocument;
    let copied = false;
    const onCopy = (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      event.clipboardData.clearData();
      event.clipboardData.setData("text/html", html);
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
      event.stopImmediatePropagation();
      copied = true;
    };
    document.addEventListener("copy", onCopy, true);
    try {
      editor.view.focus();
      return document.execCommand("copy") && copied;
    } finally {
      document.removeEventListener("copy", onCopy, true);
    }
  } catch {
    return false;
  }
}

/** 优先粘贴原生 HTML 切片；只有剪贴板确实提供纯文本时才按原样插入文字。 */
export async function pasteSelection(editor: Editor): Promise<boolean> {
  if (editor.isDestroyed) return false;
  const originalDocument = editor.state.doc;
  const originalSelection = editor.state.selection;
  const isCurrent = () =>
    !editor.isDestroyed &&
    editor.state.doc === originalDocument &&
    editor.state.selection.eq(originalSelection);
  let text = "";
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      const htmlItem = items.find((item) => item.types.includes("text/html"));
      if (htmlItem) {
        const html = await (await htmlItem.getType("text/html")).text();
        if (!html || !isCurrent()) return false;
        editor.view.focus();
        return editor.view.pasteHTML(html);
      }
      const textItem = items.find((item) => item.types.includes("text/plain"));
      if (textItem) text = await (await textItem.getType("text/plain")).text();
    } else {
      text = await navigator.clipboard.readText();
    }
  } catch {
    return false;
  }
  if (!text || !isCurrent()) return false;
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

/**
 * 应用字号。
 *
 * - 有选区：按当前 `textStyle` 属性增量更新，保留颜色/字体；
 * - 光标状态：作用到**整段**。否则光标贴着行内原子节点输入时没有任何文本被
 *   标记，字号看起来"点了没反应"，而想让表情变大恰恰就发生在这种位置。
 *   整段标记会覆盖段内已有的字号（保留颜色/字体），避免"选中 40% 文字改字号"
 *   这种意外结果。
 */
function applyFontSizeToBlock(editor: Editor, fontSize: string): boolean {
  const { state, view } = editor;
  const { $from } = state.selection;
  let depth = $from.depth;
  while (depth > 0 && !$from.node(depth).isTextblock) depth -= 1;
  if (depth === 0) return false;
  const type = state.schema.marks.textStyle;
  if (!type) return false;
  const sizeAttr = { fontSize };
  const start = $from.start(depth);
  const end = $from.end(depth);
  const tr = state.tr;
  tr.removeMark(start, end, type);
  tr.addMark(start, end, type.create(sizeAttr));
  // 段内已有的颜色/字体按原样保留，只重置字号。
  state.doc.nodesBetween(start, end, (node, position) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type !== type) continue;
      const attrs = { ...mark.attrs, ...sizeAttr };
      tr.removeMark(position, position + node.nodeSize, mark);
      tr.addMark(position, position + node.nodeSize, type.create(attrs));
    }
  });
  view.dispatch(tr);
  return true;
}

export function setFontSize(editor: Editor, fontSize: string): boolean {
  if (editor.state.selection.empty) applyFontSizeToBlock(editor, fontSize);
  return editor
    .chain()
    .focus()
    .setMark("textStyle", {
      ...editor.getAttributes("textStyle"),
      fontSize,
    })
    .run();
}

/**
 * 字号自定义输入：把纯数字（16、400、512）收窄到白名单区间后套用。
 * 返回实际生效的 px 值；无法解析时返回 null，调用方保留原值。
 */
export function setFontSizeFromInput(editor: Editor, value: string): number | null {
  const parsed = Number.parseInt(value.trim().replace(/px$/iu, ""), 10);
  if (!Number.isFinite(parsed)) return null;
  const clamped = Math.min(FONT_SIZE_RANGE.max, Math.max(FONT_SIZE_RANGE.min, parsed));
  setFontSize(editor, `${clamped}px`);
  return clamped;
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
