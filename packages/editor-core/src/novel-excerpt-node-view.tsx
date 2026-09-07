import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { createElement, type ReactNode } from "react";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import { isReaderPlatform, readerTop, readerBottom, readerAttribution, READER_PLATFORM_POLICY } from "@ricetext/document-core";
import type { NovelExcerptAttributes } from "./types.js";
import { sanitizeUrl } from "./sanitize.js";

// The same chrome tree is used by React node views and persisted HTML.
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
export function NovelExcerptNodeView({ attrs, sourceLabel = "查看来源" }: {
  attrs: NovelExcerptAttributes;
  sourceLabel?: string;
}) {
  const sourceUrl = sanitizeUrl(attrs.sourceUrl, "link");
  const reader = isReaderPlatform(attrs.variant);
  const raw = attrs as unknown as Record<string, unknown>;
  return (
    <NodeViewWrapper as="aside" className={"rt-novel-excerpt rt-novel-excerpt--" + attrs.variant}
      data-node-type="novel-excerpt" data-variant={attrs.variant}
      data-book-title={attrs.bookTitle} data-chapter-title={attrs.chapterTitle}
      data-author={attrs.author} data-source-url={sourceUrl ?? ""}
      data-reader-time={attrs.readerTime} data-battery-level={attrs.batteryLevel}
      data-page-label={attrs.pageLabel} data-progress-label={attrs.progressLabel} data-header-label={attrs.headerLabel}
      data-empty-bubble={isReaderPlatform(attrs.variant) ? String(READER_PLATFORM_POLICY[attrs.variant].emptyBubble) : undefined}>
      {reader ? <>
        <div className="rt-reader-page">
          {readerTop(raw).map(chrome)}
          <NodeViewContent className="rt-novel-excerpt__content" />
          {chrome(readerBottom(raw), 0)}
        </div>
        {chrome(readerAttribution(raw), 0)}
      </> : <>
        <header contentEditable={false}>
          {attrs.bookTitle && <strong>{attrs.bookTitle}</strong>}
          {attrs.chapterTitle && <span>{attrs.chapterTitle}</span>}
          {attrs.author && <small>{attrs.author}</small>}
        </header>
        <NodeViewContent className="rt-novel-excerpt__content" />
        {sourceUrl && <footer contentEditable={false}><a href={sourceUrl} target="_blank" rel="noopener noreferrer nofollow">{sourceLabel}</a></footer>}
      </>}
    </NodeViewWrapper>
  );
}
