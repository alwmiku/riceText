import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { createElement, useCallback, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import { normalizeNovelExcerptVariant, readerTop, readerBottom, READER_PLATFORM_POLICY } from "@ricetext/document-core";
import type { NovelExcerptAttributes } from "./types.js";
import { sanitizeUrl } from "./sanitize.js";
import { useReaderPagination } from "./use-reader-pagination.js";

// React 节点视图与持久化 HTML 共用同一套阅读页结构。
function chrome(spec: DOMOutputSpec, key: number): ReactNode {
  if (typeof spec === "string") return spec;
  if (!Array.isArray(spec)) return null;
  const [tag, raw, ...children] = spec;
  const props = Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([name, value]) => [
    name === "class" ? "className" : name === "contenteditable" ? "contentEditable" : name === "stroke-width" ? "strokeWidth" : name,
    name === "contenteditable" ? value === "true" : value,
  ]));
  return createElement((tag as string).split(" ").at(-1)!, { ...props, key }, ...children.map((child, index) => chrome(child as DOMOutputSpec, index)));
}
/** 选区是否落在该摘录内：整节点被选中，或光标在摘录正文里。 */
function selectionInsideExcerpt(editor: Editor | null, getPos: (() => number | undefined) | undefined): boolean {
  if (!editor || !getPos) return false;
  let pos: number | undefined;
  try { pos = getPos(); } catch { return false; }
  if (pos === undefined) return false;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "novelExcerpt") return false;
  const { selection } = editor.state;
  if (selection instanceof NodeSelection) return selection.from === pos;
  return selection.from > pos && selection.to < pos + node.nodeSize;
}

/** 摘录是带正文的容器节点，点击只会把光标放进正文，因此按选区位置判断选中态。 */
function useExcerptActive(editor: Editor | null, getPos: (() => number | undefined) | undefined): boolean {
  const getPosRef = useRef(getPos);
  getPosRef.current = getPos;
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (!editor) return () => {};
    editor.on("selectionUpdate", onStoreChange);
    editor.on("update", onStoreChange);
    return () => { editor.off("selectionUpdate", onStoreChange); editor.off("update", onStoreChange); };
  }, [editor]);
  const getSnapshot = useCallback(() => selectionInsideExcerpt(editor, getPosRef.current), [editor]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function NovelExcerptNodeView({ attrs, editable = false, editor = null, getPos, selected = false }: {
  attrs: NovelExcerptAttributes;
  editable?: boolean;
  editor?: Editor | null;
  getPos?: () => number | undefined;
  selected?: boolean;
}) {
  const sourceUrl = sanitizeUrl(attrs.sourceUrl, "link");
  const variant = normalizeNovelExcerptVariant(attrs.variant);
  const raw = { ...attrs, variant };
  const pagination = useReaderPagination(!editable);
  const inside = useExcerptActive(editor, getPos);
  const active = editable && (selected || inside);
  return (
    <NodeViewWrapper as="aside" className={"rt-novel-excerpt rt-novel-excerpt--" + variant + (active ? " rt-novel-excerpt--active" : "")}
      data-node-type="novel-excerpt" data-variant={variant}
      data-page-index={pagination.pages.index} data-page-count={pagination.pages.count}
      data-book-title={attrs.bookTitle} data-chapter-title={attrs.chapterTitle}
      data-author={attrs.author} data-source-url={sourceUrl ?? ""}
      data-reader-time={attrs.readerTime} data-battery-level={attrs.batteryLevel}
      data-page-label={attrs.pageLabel} data-progress-label={attrs.progressLabel} data-header-label={attrs.headerLabel}
      data-empty-bubble={String(READER_PLATFORM_POLICY[variant].emptyBubble)}>
        <div className="rt-reader-page" ref={pagination.pageRef} data-paginated={pagination.paginated}>
          {readerTop(raw).map(chrome)}
          <div className="rt-reader-viewport" ref={pagination.viewportRef}
            role={pagination.paginated ? "group" : undefined} aria-label={pagination.paginated ? "摘录分页正文" : undefined}
            tabIndex={pagination.paginated ? 0 : undefined}
            onPointerDown={pagination.onPointerDown} onPointerUp={pagination.onPointerUp}
            onPointerCancel={pagination.onPointerCancel} onKeyDown={pagination.onKeyDown}>
            <NodeViewContent className="rt-novel-excerpt__content" style={{ transform: pagination.paginated ? `translateX(calc(-${pagination.pages.index} * (var(--reader-column-width, 100%) + var(--reader-column-gap, 24px))))` : undefined }} />
          </div>
          {chrome(readerBottom(raw, pagination.pages), 0)}
        </div>
    </NodeViewWrapper>
  );
}
