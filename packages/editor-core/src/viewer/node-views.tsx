import type { Extensions, Editor } from "@tiptap/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import { useEffect, useReducer } from "react";

import {
  AttachmentRef,
  DiceRoll,
  InlineCommentAnchor,
  Mention,
  NovelExcerpt,
  PollRef,
  ReplyGate,
  RichImage,
  Spoiler,
  editorExtensions,
} from "../extensions.js";
import { PollResultChart } from "../poll-result-chart.js";
import type {
  AttachmentReferenceAttributes,
  DiceRollAttributes,
  InlineCommentAnchorAttributes,
  MentionAttributes,
  NovelExcerptAttributes,
  PollReferenceAttributes,
  ReplyGateAttributes,
  RichImageAttributes,
} from "../types.js";
import { formatBytes } from "./prepare.js";
import type {
  ViewerContext,
  ViewerContextRef,
  ViewerNodeProps,
  ViewerRichImageNodeProps,
} from "./types.js";

/**
 * 订阅查看器上下文：外部交互状态（附件购买、投票等）变化时，
 * 节点视图组件必须重新渲染才能读到 viewerRef.current 的最新值。
 */
function useViewerContext(viewerRef: ViewerContextRef): ViewerContext {
  const [, forceRender] = useReducer((count: number) => count + 1, 0);
  useEffect(
    () => viewerRef.subscribe(forceRender),
    [viewerRef, forceRender],
  );
  return viewerRef.current;
}

function getRichImageIndex(
  editor: Editor,
  getPos: () => number | undefined,
): number {  const currentPos = getPos();
  if (currentPos === undefined) return 0;
  let index = 0;
  let found = false;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "richImage") {
      if (pos === currentPos) {
        found = true;
        return false;
      }
      index += 1;
    }
    return true;
  });
  return found ? index : 0;
}

function RichImageNodeView({
  node,
  getPos,
  editor,
  viewerRef,
}: ViewerRichImageNodeProps) {
  const viewer = useViewerContext(viewerRef);
  const attrs = node.attrs as unknown as RichImageAttributes;
  const index = getRichImageIndex(editor, getPos);
  const image = viewer.galleryImages[index];
  const open = () => {
    if (!viewer.enableLightbox || !image) return;
    viewer.controller.openImage(index);
    viewer.interactions.onImageOpen?.(image);
  };
  return (
    <NodeViewWrapper
      as="figure"
      className={`rt-rich-image rt-rich-image--${attrs.align}`}
      style={{ width: `${attrs.width}%` }}
    >
      <button
        type="button"
        className="rt-rich-image__open"
        disabled={!viewer.enableLightbox}
        onClick={open}
        aria-label={attrs.alt || "Open image"}
      >
        <img src={attrs.src} alt={attrs.alt} loading="lazy" />
      </button>
      {attrs.caption ? <figcaption>{attrs.caption}</figcaption> : null}
    </NodeViewWrapper>
  );
}

function DiceRollNodeView({ node, viewerRef }: ViewerNodeProps) {
  const viewer = useViewerContext(viewerRef);
  const attrs = node.attrs as unknown as DiceRollAttributes;
  const dice = (
    <span className="rt-dice-roll" title={attrs.rolls.join(" + ")}>
      <span>{attrs.expression}</span>
      <strong>= {attrs.total}</strong>
    </span>
  );
  return (
    <NodeViewWrapper as="span">
      {viewer.interactions.onDiceReroll ? (
        <button
          type="button"
          className="rt-dice-roll__button"
          title={viewer.labels.rerollDice}
          onClick={() => viewer.interactions.onDiceReroll?.(attrs)}
        >
          {dice}
        </button>
      ) : (
        dice
      )}
    </NodeViewWrapper>
  );
}

function InlineCommentAnchorNodeView({ node, viewerRef }: ViewerNodeProps) {
  const viewer = useViewerContext(viewerRef);
  const attrs = node.attrs as unknown as InlineCommentAnchorAttributes;
  const empty = attrs.count <= 0;
  return (
    <NodeViewWrapper as="span" className="rt-inline-comment-anchor-wrap">
      <button
        type="button"
        className={`rt-inline-comment-anchor rt-inline-comment-anchor--${attrs.placement}${empty ? " rt-inline-comment-anchor--empty" : ""}`}
        data-node-type="inline-comment-anchor"
        data-thread-id={attrs.threadId}
        data-count={attrs.count}
        data-placement={attrs.placement}
        aria-label={`${viewer.labels.inlineComments}: ${attrs.count}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          viewer.interactions.onInlineCommentActivate?.(attrs);
        }}
      >
        {empty ? "" : attrs.count}
      </button>
    </NodeViewWrapper>
  );
}

function MentionNodeView({ node, viewerRef }: ViewerNodeProps) {
  const viewer = useViewerContext(viewerRef);
  const attrs = node.attrs as unknown as MentionAttributes;
  const interactive = Boolean(viewer.interactions.onMentionActivate);
  return (
    <NodeViewWrapper as="span">
      <span
        className={`rt-mention ${attrs.resolved ? "rt-mention--resolved" : "rt-mention--unresolved"}`}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={() => viewer.interactions.onMentionActivate?.(attrs)}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && interactive)
            viewer.interactions.onMentionActivate?.(attrs);
        }}
      >
        @{attrs.name}
        {viewer.interactions.renderMentionCard ? (
          <span className="rt-mention__card">
            {viewer.interactions.renderMentionCard(attrs)}
          </span>
        ) : null}
      </span>
    </NodeViewWrapper>
  );
}

function AttachmentNodeView({ node, viewerRef }: ViewerNodeProps) {
  const viewer = useViewerContext(viewerRef);
  const attrs = node.attrs as unknown as AttachmentReferenceAttributes;
  const state = viewer.interactions.getAttachmentState?.(attrs) ?? {
    available: attrs.priceCoins === 0,
    pending: false,
  };
  return (
    <NodeViewWrapper>
      <button
        type="button"
        className="rt-attachment"
        disabled={state.pending || !viewer.interactions.onAttachmentActivate}
        onClick={() => viewer.interactions.onAttachmentActivate?.(attrs)}
      >
        <span className="rt-attachment__name">{attrs.name}</span>
        <small>
          {formatBytes(attrs.size)} · {attrs.mimeType}
        </small>
        <strong>
          {state.available
            ? viewer.labels.download
            : `${viewer.labels.purchase} · ${attrs.priceCoins} ${viewer.labels.coins}`}
        </strong>
      </button>
    </NodeViewWrapper>
  );
}

function PollNodeView({ node, viewerRef }: ViewerNodeProps) {
  const viewer = useViewerContext(viewerRef);
  const attrs = node.attrs as unknown as PollReferenceAttributes;
  const state = viewer.interactions.getPollState?.(attrs) ?? {
    selectedOptionIds: [],
    votesByOption: {},
    canVote: true,
    pending: false,
  };
  return (
    <NodeViewWrapper
      as="section"
      className="rt-poll"
      aria-labelledby={`poll-${attrs.pollId}`}
    >
      <h3 id={`poll-${attrs.pollId}`}>{attrs.question}</h3>
      <PollResultChart
        options={attrs.options.map((option) => ({
          id: option.id,
          label: option.label,
          votes: Math.max(0, state.votesByOption[option.id] ?? 0),
          selected: state.selectedOptionIds.includes(option.id),
          disabled:
            !state.canVote ||
            state.pending ||
            (!viewer.interactions.onPollVote &&
              !viewer.interactions.onPollSubmit),
          multiple: attrs.multiple,
        }))}
        voteLabel={viewer.labels.votes}
        voted={state.selectedOptionIds.length > 0}
        groupName={`poll-${attrs.pollId}`}
        onVote={(optionId) => viewer.interactions.onPollVote?.(attrs, optionId)}
        onSubmit={(optionIds) => {
          if (viewer.interactions.onPollSubmit) {
            viewer.interactions.onPollSubmit(attrs, optionIds);
          } else {
            optionIds.forEach((optionId) =>
              viewer.interactions.onPollVote?.(attrs, optionId),
            );
          }
        }}
      />
    </NodeViewWrapper>
  );
}

function ReplyGateNodeView({ node, viewerRef }: ViewerNodeProps) {
  const viewer = useViewerContext(viewerRef);
  const attrs = node.attrs as unknown as ReplyGateAttributes;
  const visible = viewer.interactions.isReplyGateVisible?.(attrs) === true;
  if (!visible) {
    return (
      <NodeViewWrapper
        as="section"
        className="rt-reply-gate rt-reply-gate--locked"
      >
        <button
          type="button"
          onClick={() => viewer.interactions.onReplyGateRequest?.(attrs)}
        >
          {attrs.prompt}
        </button>
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper
      as="section"
      className="rt-reply-gate rt-reply-gate--visible"
    >
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

function NovelExcerptNodeView({ node, viewerRef }: ViewerNodeProps) {
  const viewer = useViewerContext(viewerRef);
  const attrs = node.attrs as unknown as NovelExcerptAttributes;
  return (
    <NodeViewWrapper
      as="aside"
      className={`rt-novel-excerpt rt-novel-excerpt--${attrs.variant}`}
    >
      <header>
        <strong>{attrs.bookTitle}</strong>
        <span>{attrs.chapterTitle}</span>
        <small>{attrs.author}</small>
      </header>
      <div className="rt-novel-excerpt__content">
        <NodeViewContent />
      </div>
      {attrs.sourceUrl ? (
        <a
          href={attrs.sourceUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          {viewer.labels.source}
        </a>
      ) : null}
    </NodeViewWrapper>
  );
}

/** 构建一组附加了查看器 NodeView 的只读 Tiptap 扩展。 */
export function createViewerExtensions(
  viewerRef: ViewerContextRef,
): Extensions {
  return editorExtensions().map((extension) => {
    switch (extension.name) {
      case "richImage":
        return RichImage.extend({
          addNodeView: () =>
            ReactNodeViewRenderer(
              ({ node, getPos, editor }) => (
                <RichImageNodeView
                  node={node}
                  getPos={getPos}
                  editor={editor}
                  viewerRef={viewerRef}
                />
              ),
              { trackNodeViewPosition: true },
            ),
        });
      case "diceRoll":
        return DiceRoll.extend({
          addNodeView: () =>
            ReactNodeViewRenderer(({ node }) => (
              <DiceRollNodeView node={node} viewerRef={viewerRef} />
            )),
        });
      case "inlineCommentAnchor":
        return InlineCommentAnchor.extend({
          addNodeView: () =>
            ReactNodeViewRenderer(({ node }) => (
              <InlineCommentAnchorNodeView node={node} viewerRef={viewerRef} />
            )),
        });
      case "mention":
        return Mention.extend({
          addNodeView: () =>
            ReactNodeViewRenderer(({ node }) => (
              <MentionNodeView node={node} viewerRef={viewerRef} />
            )),
        });
      case "attachmentRef":
        return AttachmentRef.extend({
          addNodeView: () =>
            ReactNodeViewRenderer(({ node }) => (
              <AttachmentNodeView node={node} viewerRef={viewerRef} />
            )),
        });
      case "pollRef":
        return PollRef.extend({
          addNodeView: () =>
            ReactNodeViewRenderer(({ node }) => (
              <PollNodeView node={node} viewerRef={viewerRef} />
            )),
        });
      case "replyGate":
        return ReplyGate.extend({
          addNodeView: () =>
            ReactNodeViewRenderer(({ node }) => (
              <ReplyGateNodeView node={node} viewerRef={viewerRef} />
            )),
        });
      case "novelExcerpt":
        return NovelExcerpt.extend({
          addNodeView: () =>
            ReactNodeViewRenderer(({ node }) => (
              <NovelExcerptNodeView node={node} viewerRef={viewerRef} />
            )),
        });
      case "spoiler":
        return Spoiler.extend({
          renderHTML() {
            return [
              "span",
              {
                class: "rt-spoiler",
                "data-spoiler": "true",
                role: "button",
                tabindex: "0",
                "aria-expanded": "false",
              },
              0,
            ];
          },
        });
      default:
        return extension;
    }
  });
}
