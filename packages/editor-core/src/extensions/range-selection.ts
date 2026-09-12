import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * 跨选区高亮行内原子节点。
 *
 * ProseMirror 只在「整块被选中」（NodeSelection）时给节点加
 * `ProseMirror-selectednode`；当选区只是**跨过**一个原子节点（例如
 * 「这是[表情]下划线」整段选中）时，浏览器原生的 `::selection` 不会绘制
 * `contenteditable="false"` 的原子节点，于是文字有选中背景、表情/骰子/提及/
 * 评论计数却是一片空白，看起来像没被选中。
 *
 * 这里把「完整落在文本选区区间内的原子节点」用装饰标出来，样式交给宿主：
 * `[data-rt-range-selected]`。
 */
export const RANGE_SELECTION_ATTRIBUTE = "data-rt-range-selected";

export const rangeSelectionKey = new PluginKey("rangeSelectionHighlight");

/**
 * 找出 [from, to) 区间内被完整覆盖的原子节点位置。
 *
 * 只做一层 `nodesBetween`：它按文档顺序返回区间内的所有节点（含嵌套），
 * 外层容器（段落、列表等）不是原子会被跳过，内层原子仍会被单独返回，
 * 因此不需要自己递归。
 */
function atomPositionsInRange(doc: ProseMirrorNode, from: number, to: number): number[] {
  const positions: number[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isAtom && pos >= from && pos + node.nodeSize <= to) positions.push(pos);
  });
  return positions;
}

/** 可编辑编辑器里的选区高亮扩展；只读查看器不挂载。 */
export const RangeSelectionHighlight = Extension.create({
  name: "rangeSelectionHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: rangeSelectionKey,
        props: {
          decorations(state) {
            const { selection } = state;
            // 整块选中（NodeSelection 等）已经由 ProseMirror 自己加样式，不叠加。
            if (selection.empty || !(selection instanceof TextSelection)) return null;
            const decorations: Decoration[] = [];
            for (const pos of atomPositionsInRange(state.doc, selection.from, selection.to)) {
              const node = state.doc.nodeAt(pos);
              if (!node) continue;
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  [RANGE_SELECTION_ATTRIBUTE]: node.type.name,
                }),
              );
            }
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
