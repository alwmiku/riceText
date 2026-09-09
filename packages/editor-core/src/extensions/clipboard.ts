import { Extension } from "@tiptap/core";
import type { Node, Slice } from "@tiptap/pm/model";
import { AllSelection, Plugin, PluginKey, Selection, TextSelection } from "@tiptap/pm/state";
import { capabilitiesOfSpec } from "@ricetext/document-core";

/**
 * 原子节点的正文存放在属性中，不能依赖 node.textContent。
 *
 * 投影规则由各扩展在规格里声明的 `text.leafText` 能力提供；这里只保留
 * 结构性兜底（换行）与 ProseMirror 原生 `spec.leafText`，不按扩展名分支。
 */
function leafText(node: Node): string {
  const declared = capabilitiesOfSpec(node.type.spec)?.text?.leafText;
  if (declared) return declared(node);
  if (node.type.name === "hardBreak") return "\n";
  return node.type.spec.leafText?.(node) ?? "";
}

/** 共享编辑器剪贴板策略，沿用标准 HTML/plain 与 ProseMirror slice 协议。 */
export const SharedClipboard = Extension.create({
  name: "sharedClipboard",

  addProseMirrorPlugins() {
    let internalHTML = false;
    const internalSlices = new WeakSet<Slice>();
    return [
      new Plugin({
        key: new PluginKey("sharedClipboard"),
        props: {
          // 只读取传入 slice，保留空段落及首尾空白，避免夹带当前选区外的文字。
          clipboardTextSerializer: (slice) =>
            slice.content.textBetween(0, slice.content.size, "\n\n", leafText),
          transformPastedHTML(html, view) {
            const dom = view.dom.ownerDocument.createElement("div");
            dom.innerHTML = html;
            const marker = dom.querySelector("[data-pm-slice]")?.getAttribute("data-pm-slice");
            internalHTML = !!marker && /^\d+ \d+(?: -\d+)? \[/.test(marker);
            return html;
          },
          transformPasted(slice, _view, plain) {
            // 同时支持原生粘贴与 view.pasteHTML；后者的事件没有 clipboardData。
            if (internalHTML && !plain) internalSlices.add(slice);
            internalHTML = false;
            return slice;
          },
          handlePaste(view, _event, slice) {
            if (!internalSlices.has(slice)) return false;
            internalSlices.delete(slice);
            // 列表等容器已经由原生 slice 上下文保留，只修复开放的文本块。
            if (slice.openStart > 1 || slice.openEnd > 1 || !(slice.openStart || slice.openEnd))
              return false;
            let hasTextBlock = false;
            let blockContent = slice.content.childCount > 0;
            slice.content.forEach((node) => {
              blockContent &&= node.isBlock;
              // 默认格式同样需要保留，不能被空目标残留的缩进或对齐覆盖。
              hasTextBlock ||= node.isTextblock && !node.type.spec.code;
            });
            if (!blockContent || !hasTextBlock) return false;

            const { selection, doc } = view.state;
            const { $from, $to } = selection;
            let from: number;
            let to: number;
            if (
              selection instanceof AllSelection &&
              doc.childCount === 1 &&
              doc.firstChild!.isTextblock &&
              !doc.firstChild!.type.spec.code &&
              doc.firstChild!.content.size === 0
            ) {
              from = 0;
              to = doc.content.size;
            } else if (
              selection instanceof TextSelection &&
              $from.sameParent($to) &&
              $from.parent.isTextblock &&
              !$from.parent.type.spec.code &&
              $from.parent.content.size === 0
            ) {
              from = $from.before();
              to = $to.after();
            } else {
              return false;
            }

            const start = doc.resolve(from);
            // 在列表首段等受 schema 限制的位置，仍由原生粘贴负责适配。
            if (!start.parent.canReplace(start.index(), start.index() + 1, slice.content))
              return false;
            const tr = view.state.tr.replaceWith(from, to, slice.content);
            tr.setSelection(Selection.near(tr.doc.resolve(from + slice.content.size), -1));
            view.dispatch(tr.setMeta("paste", true).setMeta("uiEvent", "paste").scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
