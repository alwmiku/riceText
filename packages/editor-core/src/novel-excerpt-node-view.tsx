import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { createElement, type ReactNode } from "react";
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
export function NovelExcerptNodeView({ attrs, editable = false }: {
  attrs: NovelExcerptAttributes;
  editable?: boolean;
}) {
  const sourceUrl = sanitizeUrl(attrs.sourceUrl, "link");
  const variant = normalizeNovelExcerptVariant(attrs.variant);
  const raw = { ...attrs, variant };
  const pagination = useReaderPagination(!editable);
  return (
    <NodeViewWrapper as="aside" className={"rt-novel-excerpt rt-novel-excerpt--" + variant}
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
