import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

import type { PollReferenceAttributes } from "./types.js";

/** Editable poll NodeView that exposes persisted options without making them contenteditable. */
export function PollEditorView({ node, selected }: NodeViewProps) {
  const attrs = node.attrs as unknown as PollReferenceAttributes;
  return (
    <NodeViewWrapper
      as="section"
      className={`rt-poll rt-poll--editor${selected ? " rt-poll--selected" : ""}`}
      data-node-type="poll-ref"
      contentEditable={false}
    >
      <h3>{attrs.question}</h3>
      <div className="rt-poll__editor-options">
        {attrs.options.map((option) => (
          <div key={option.id} className="rt-poll__editor-option">
            <span className="rt-poll__editor-marker" aria-hidden="true" />
            <span>{option.label}</span>
          </div>
        ))}
      </div>
    </NodeViewWrapper>
  );
}
