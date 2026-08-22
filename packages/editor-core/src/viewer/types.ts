import type { JSONContent } from "@tiptap/core";
import type { NodeViewProps } from "@tiptap/react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import type {
  AttachmentReferenceAttributes,
  DiceRollAttributes,
  InlineCommentAnchorAttributes,
  MentionAttributes,
  NovelExcerptAttributes,
  PollReferenceAttributes,
  ReplyGateAttributes,
  ViewerAttachmentState,
  ViewerImage,
  ViewerPollState,
} from "../types.js";

/** Current full-screen image viewer state. */
export interface ViewerLightboxState {
  /** Selected image index, or `null` while the lightbox is closed. */
  index: number | null;
  /** Zoom scale clamped between 0.5 and 4. */
  zoom: number;
  /** Horizontal pan displacement in CSS pixels. */
  offsetX: number;
  /** Vertical pan displacement in CSS pixels. */
  offsetY: number;
}

/** Interaction controller returned by {@link useRichTextViewerController}. */
export interface RichTextViewerController {
  /** Current lightbox transform and selection. */
  lightbox: ViewerLightboxState;
  /** Spoiler render keys explicitly revealed on touch or click. */
  revealedSpoilers: ReadonlySet<string>;
  /** Opens an image by gallery index. */
  openImage: (index: number) => void;
  /** Closes the full-screen image viewer. */
  closeImage: () => void;
  /** Selects the previous image, wrapping at the start. */
  previousImage: () => void;
  /** Selects the next image, wrapping at the end. */
  nextImage: () => void;
  /** Adds a zoom delta while retaining the current pan. */
  changeZoom: (delta: number) => void;
  /** Resets zoom and pan for the current image. */
  resetTransform: () => void;
  /** Adds a drag displacement to the current pan. */
  panBy: (deltaX: number, deltaY: number) => void;
  /** Reveals or hides one spoiler instance. */
  toggleSpoiler: (key: string) => void;
}

/** Application callbacks and hydrated state used by the static viewer. */
export interface RichTextViewerInteractions {
  /** Loads or opens the selected inline-comment thread. */
  onInlineCommentActivate?: (attrs: InlineCommentAnchorAttributes) => void;
  /** Explicitly requests a new persisted result for a dice roll. */
  onDiceReroll?: (attrs: DiceRollAttributes) => void;
  /** Opens a user profile or mention action. */
  onMentionActivate?: (attrs: MentionAttributes) => void;
  /** Renders detailed mention content shown on hover and keyboard focus. */
  renderMentionCard?: (attrs: MentionAttributes) => ReactNode;
  /** Returns whether the current identity may see a gated block. */
  isReplyGateVisible?: (attrs: ReplyGateAttributes) => boolean;
  /** Starts the reply or sign-in flow required to reveal a gated block. */
  onReplyGateRequest?: (attrs: ReplyGateAttributes) => void;
  /** Returns hydrated ownership and pending state for an attachment. */
  getAttachmentState?: (
    attrs: AttachmentReferenceAttributes,
  ) => ViewerAttachmentState;
  /** Purchases or downloads the selected attachment. */
  onAttachmentActivate?: (attrs: AttachmentReferenceAttributes) => void;
  /** Returns current vote totals, selection, permission, and pending state. */
  getPollState?: (attrs: PollReferenceAttributes) => ViewerPollState;
  /** Submits the complete current poll selection after the user confirms. */
  onPollSubmit?: (
    attrs: PollReferenceAttributes,
    optionIds: readonly string[],
  ) => void;
  /** Legacy single-option vote callback used when no submit callback is supplied. */
  onPollVote?: (attrs: PollReferenceAttributes, optionId: string) => void;
  /** Observes an image being opened in the full-screen gallery. */
  onImageOpen?: (image: ViewerImage) => void;
  /** Observes activation of a safe document link. */
  onLinkActivate?: (
    href: string,
    event: ReactMouseEvent<HTMLAnchorElement>,
  ) => void;
}

/** Localized text used by viewer-only controls. */
export interface RichTextViewerLabels {
  /** Accessible label for an inline-comment counter. */
  inlineComments: string;
  /** Accessible label for explicit dice reroll. */
  rerollDice: string;
  /** Text for a free attachment action. */
  download: string;
  /** Text for a paid attachment action. */
  purchase: string;
  /** Currency unit appended to attachment prices. */
  coins: string;
  /** Poll vote unit appended to totals. */
  votes: string;
  /** Label for the optional novel excerpt source link. */
  source: string;
  /** Lightbox close control. */
  closeImage: string;
  /** Lightbox previous-image control. */
  previousImage: string;
  /** Lightbox next-image control. */
  nextImage: string;
  /** Lightbox zoom-in control. */
  zoomIn: string;
  /** Lightbox zoom-out control. */
  zoomOut: string;
  /** Lightbox reset control. */
  resetZoom: string;
}

/** Props for the static, non-editable rich-text renderer. */
export interface RichTextViewerProps {
  /** Tiptap JSON to sanitize and render. */
  content: JSONContent;
  /** Additional class applied to the viewer root. */
  className?: string;
  /** Application callbacks and externally hydrated feature state. */
  interactions?: RichTextViewerInteractions;
  /** Optional externally owned viewer controller. */
  controller?: RichTextViewerController;
  /** Whether rich images open in the built-in lightbox. Defaults to `true`. */
  enableLightbox?: boolean;
  /** Overrides individual control labels. */
  labels?: Partial<RichTextViewerLabels>;
  /** Receives headings extracted from the projected document for a sidebar TOC. */
  onTocChange?: (items: ViewerTocItem[]) => void;
}

/** 由阅读器正文标题生成的目录条目。 */
export interface ViewerTocItem {
  /** 标题在正文中的文档顺序索引，用于 DOM 定位。 */
  index: number;
  /** 标题级别（1–6）。 */
  level: number;
  /** 标题可见文本。 */
  text: string;
}

export const defaultLabels: RichTextViewerLabels = {
  inlineComments: "Open inline comments",
  rerollDice: "Reroll dice",
  download: "Download",
  purchase: "Purchase",
  coins: "coins",
  votes: "votes",
  source: "Source",
  closeImage: "Close image",
  previousImage: "Previous image",
  nextImage: "Next image",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  resetZoom: "Reset zoom",
};

/** Viewer-only context passed to every custom NodeView through a stable ref. */
export interface ViewerContext {
  interactions: RichTextViewerInteractions;
  controller: RichTextViewerController;
  labels: RichTextViewerLabels;
  enableLightbox: boolean;
  galleryImages: readonly ViewerImage[];
}

/** Stable ref wrapper so NodeViews always read the latest viewer context. */
export interface ViewerContextRef {
  current: ViewerContext;
}

export type ViewerNodeProps = Pick<NodeViewProps, "node"> & {
  viewerRef: ViewerContextRef;
};
export type ViewerRichImageNodeProps = Pick<
  NodeViewProps,
  "node" | "getPos" | "editor"
> & { viewerRef: ViewerContextRef };
