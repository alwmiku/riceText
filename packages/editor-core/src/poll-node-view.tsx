import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

import type { PollReferenceAttributes } from "./types.js";

/** 可编辑的投票 NodeView，展示持久化选项但不使其可编辑。 */
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
