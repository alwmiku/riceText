import type { Editor } from "@tiptap/core";
import {
  REVISION_SURFACE_ATTRIBUTE,
  REVISION_SURFACE_WHEN_ATTRIBUTE,
  effectiveRevisionSurface,
  revisionCapabilityOfSpec,
  type RevisionCapability,
} from "@ricetext/document-core";

import { getEditorViewDom } from "./prepare.js";

/**
 * 按扩展声明给渲染 DOM 打修订面标记。
 *
 * 这是「哪些区域可以修订」的唯一投影点：节点按自己的规格声明逐个打点
 * （未声明的原子节点默认装饰），标记按自己声明的 `domSelector` 定位。
 * 消费方只读 {@link REVISION_SURFACE_ATTRIBUTE}，因此新增扩展无需改动消费者。
 */
export function applyRevisionSurfaces(editor: Editor): void {
  const dom = getEditorViewDom(editor);
  if (!dom) return;

  for (const mark of Object.values(editor.schema.marks)) {
    const revision = revisionCapabilityOfSpec(mark.spec);
    if (!revision?.domSelector) continue;
    dom.querySelectorAll(revision.domSelector).forEach((element) => {
      if (element instanceof HTMLElement) markRevisionSurface(element, revision);
    });
  }

  editor.state.doc.descendants((node, pos) => {
    const revision = revisionCapabilityOfSpec(node.type.spec);
    // 未声明且按默认判为正文的节点不落标记，保持 DOM 干净。
    if (!revision && effectiveRevisionSurface(node.type.spec, node.type.isAtom) === "prose") return;
    const nodeDom = nodeDomAt(editor, pos);
    if (!nodeDom) return;
    // 无文本的原子节点（换行、分隔线）不参与修订，也不该改变现有选区行为。
    if (!revision && !(nodeDom.textContent ?? "").trim()) return;
    markRevisionSurface(nodeDom, revision);
  });
}

function nodeDomAt(editor: Editor, pos: number): HTMLElement | null {
  try {
    const dom = editor.view.nodeDOM(pos);
    return dom instanceof HTMLElement ? dom : null;
  } catch {
    return null;
  }
}

function markRevisionSurface(element: HTMLElement, revision: RevisionCapability | undefined): void {
  const when = revision?.proseWhen;
  element.setAttribute(REVISION_SURFACE_ATTRIBUTE, when ? "when" : (revision?.surface ?? "chrome"));
  if (when) element.setAttribute(REVISION_SURFACE_WHEN_ATTRIBUTE, when);
  else element.removeAttribute(REVISION_SURFACE_WHEN_ATTRIBUTE);
}
