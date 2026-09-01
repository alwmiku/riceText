import type { Extensions, JSONContent } from "@tiptap/core";
import type { NodeViewProps } from "@tiptap/react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import type {
  AttachmentReferenceAttributes,
  DiceRollAttributes,
  InlineCommentAnchorAttributes,
  MentionAttributes,
  PollReferenceAttributes,
  ReplyGateAttributes,
  ViewerAttachmentState,
  ViewerImage,
  ViewerPollState,
} from "../types.js";

/** 当前全屏图片查看器状态。 */
export interface ViewerLightboxState {
  /** 选中的图片索引；灯箱关闭时为 `null`。 */
  index: number | null;
  /** 缩放比例，限制在 0.5 到 4 之间。 */
  zoom: number;
  /** 以 CSS 像素计的水平平移位移。 */
  offsetX: number;
  /** 以 CSS 像素计的垂直平移位移。 */
  offsetY: number;
}

/** 由 {@link useRichTextViewerController} 返回的交互控制器。 */
export interface RichTextViewerController {
  /** 当前灯箱的变换与选择状态。 */
  lightbox: ViewerLightboxState;
  /** 通过触摸或点击显式展开的剧透渲染键。 */
  revealedSpoilers: ReadonlySet<string>;
  /** 按图库索引打开图片。 */
  openImage: (index: number) => void;
  /** 关闭全屏图片查看器。 */
  closeImage: () => void;
  /** 选择上一张图片，在起始处循环。 */
  previousImage: () => void;
  /** 选择下一张图片，在末尾处循环。 */
  nextImage: () => void;
  /** 在保留当前平移的同时增加缩放增量。 */
  changeZoom: (delta: number) => void;
  /** 重置当前图片的缩放与平移。 */
  resetTransform: () => void;
  /** 为当前平移增加拖拽位移。 */
  panBy: (deltaX: number, deltaY: number) => void;
  /** 展开或隐藏某个剧透实例。 */
  toggleSpoiler: (key: string) => void;
}

/** 静态查看器使用的应用回调与已填充（hydrated）状态。 */
export interface RichTextViewerInteractions {
  /** 加载或打开选中的行内评论会话（thread）。 */
  onInlineCommentActivate?: (attrs: InlineCommentAnchorAttributes) => void;
  /** 显式请求骰子掷出的新持久化结果。 */
  onDiceReroll?: (attrs: DiceRollAttributes) => void;
  /** 打开用户主页或执行提及操作。 */
  onMentionActivate?: (attrs: MentionAttributes) => void;
  /** 渲染悬停与键盘聚焦时显示的提及详情内容。 */
  renderMentionCard?: (attrs: MentionAttributes) => ReactNode;
  /** 返回当前身份是否可以查看门控块。 */
  isReplyGateVisible?: (attrs: ReplyGateAttributes) => boolean;
  /** 启动展示门控块所需的回复或登录流程。 */
  onReplyGateRequest?: (attrs: ReplyGateAttributes) => void;
  /** 返回附件的已填充（hydrated）拥有状态与待处理状态。 */
  getAttachmentState?: (
    attrs: AttachmentReferenceAttributes,
  ) => ViewerAttachmentState;
  /** 购买或下载选中的附件。 */
  onAttachmentActivate?: (attrs: AttachmentReferenceAttributes) => void;
  /** 返回当前票数总计、选择、权限与待处理状态。 */
  getPollState?: (attrs: PollReferenceAttributes) => ViewerPollState;
  /** 在用户确认后提交完整的当前投票选择。 */
  onPollSubmit?: (
    attrs: PollReferenceAttributes,
    optionIds: readonly string[],
  ) => void;
  /** 未提供提交回调时使用的旧版单选投票回调。 */
  onPollVote?: (attrs: PollReferenceAttributes, optionId: string) => void;
  /** 观察在全屏图库中打开的图片。 */
  onImageOpen?: (image: ViewerImage) => void;
  /** 观察安全文档链接的激活。 */
  onLinkActivate?: (
    href: string,
    event: ReactMouseEvent<HTMLAnchorElement>,
  ) => void;
}

/** 仅查看器控件使用的本地化文本。 */
export interface RichTextViewerLabels {
  /** 行内评论计数器的无障碍标签。 */
  inlineComments: string;
  /** 显式骰子重掷的无障碍标签。 */
  rerollDice: string;
  /** 免费附件操作的文本。 */
  download: string;
  /** 付费附件操作的文本。 */
  purchase: string;
  /** 附加到附件价格后的货币单位。 */
  coins: string;
  /** 附加到票数总计后的投票单位。 */
  votes: string;
  /** 可选小说摘录来源链接的标签。 */
  source: string;
  /** 灯箱关闭控件。 */
  closeImage: string;
  /** 灯箱上一张图片控件。 */
  previousImage: string;
  /** 灯箱下一张图片控件。 */
  nextImage: string;
  /** 灯箱放大控件。 */
  zoomIn: string;
  /** 灯箱缩小控件。 */
  zoomOut: string;
  /** 灯箱重置控件。 */
  resetZoom: string;
}

/** 静态、不可编辑的富文本渲染器 props。 */
export interface RichTextViewerProps {
  /** 需要净化并渲染的 Tiptap JSON。 */
  content: JSONContent;
  /** 应用到查看器根元素的额外 class。 */
  className?: string;
  /** 仅补充行为的扩展，例如只读节点装饰；不得改变持久化 schema。 */
  additionalExtensions?: Extensions;
  /** 应用回调与外部填充（hydrated）的功能状态。 */
  interactions?: RichTextViewerInteractions;
  /** 可选的外部持有查看器控制器。 */
  controller?: RichTextViewerController;
  /** 富图片是否在内置灯箱中打开。默认为 `true`。 */
  enableLightbox?: boolean;
  /** 覆盖个别控件标签。 */
  labels?: Partial<RichTextViewerLabels>;
  /** 接收从投射文档中提取的标题，用于侧边栏目录。 */
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

/** 通过稳定 ref 传递给每个自定义 NodeView 的仅查看器上下文。 */
export interface ViewerContext {
  interactions: RichTextViewerInteractions;
  controller: RichTextViewerController;
  labels: RichTextViewerLabels;
  enableLightbox: boolean;
  galleryImages: readonly ViewerImage[];
}

/** 稳定 ref 包装，确保 NodeView 始终读取最新的查看器上下文。 */
export interface ViewerContextRef {
  current: ViewerContext;
  /**
   * 订阅查看器上下文变化。NodeView 组件在外部交互状态（附件购买、
   * 投票等）变化时依赖它触发重渲染，以读取最新的 `current`。
   */
  subscribe: (listener: () => void) => () => void;
}

export type ViewerNodeProps = Pick<NodeViewProps, "node"> & {
  viewerRef: ViewerContextRef;
};
export type ViewerRichImageNodeProps = Pick<
  NodeViewProps,
  "node" | "getPos" | "editor"
> & { viewerRef: ViewerContextRef };
