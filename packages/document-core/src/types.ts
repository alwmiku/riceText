import type { JSONContent } from "@tiptap/core";

/** 行内评论计数器相对于其段落的摆放位置。 */
export type InlineCommentPlacement = "start" | "end";

/** 由 `inlineCommentAnchor` 节点持久化的属性。 */
export interface InlineCommentAnchorAttributes {
  /** 稳定的服务端会话（thread）标识。 */
  threadId: string;
  /** 在会话（thread）拉取前使用的缓存回复数。 */
  count: number;
  /** 计数器位于块起始还是块末尾。 */
  placement: InlineCommentPlacement;
}

/** 富图片支持的块级对齐方式。 */
export type RichImageAlignment = "left" | "center" | "right";

/** 由 `richImage` 节点持久化的属性。 */
export interface RichImageAttributes {
  /** 稳定的已上传资源标识；外部图片为 `null`。 */
  assetId: string | null;
  /** 安全的 HTTP(S) 或同源上传 URL。 */
  src: string;
  /** 供辅助技术使用的替代文本。 */
  alt: string;
  /** 可选的可见图片说明文字。 */
  caption: string;
  /** 文章流中的块对齐方式。 */
  align: RichImageAlignment;
  /** 占可用内容列宽度的百分比。 */
  width: number;
}

/** 由骰子 API 返回并存储在文档中的不可变属性。 */
export interface DiceRollAttributes {
  /** 本次掷骰的稳定标识。 */
  rollId: string;
  /** 归一化的骰子表示法，例如 `3d5`。 */
  expression: string;
  /** 按求值顺序排列的各个骰子结果。 */
  rolls: readonly number[];
  /** 持久化的总计；渲染器绝不能重新计算新值。 */
  total: number;
  /** 当此结果是显式重掷时，上一次掷骰的标识。 */
  rerollOf: string | null;
}

/** 用于可搜索小说摘录的视觉模板。 */
export type NovelExcerptVariant =
  | "mobile-book"
  | "desktop-book"
  | "forum-evidence";

/** 由 `novelExcerpt` 块持久化的元数据。 */
export interface NovelExcerptAttributes {
  /** 来源书名。 */
  bookTitle: string;
  /** 来源章节标题。 */
  chapterTitle: string;
  /** 来源作者显示名。 */
  author: string;
  /** 可选的安全来源 URL。 */
  sourceUrl: string | null;
  /** 摘录的视觉模板。 */
  variant: NovelExcerptVariant;
}

/** 由行内 `mention` 节点持久化的属性。 */
export interface MentionAttributes {
  /** 解析成功时的稳定用户标识。 */
  userId: string | null;
  /** 用户输入或由服务端返回的显示名。 */
  name: string;
  /** 服务端是否已将此提及解析为某个用户。 */
  resolved: boolean;
  /** 悬停卡片使用的可选安全头像 URL。 */
  avatarUrl: string | null;
}

/** 由回复门控内容块持久化的属性。 */
export interface ReplyGateAttributes {
  /** 用于查询读者访问权限的稳定门控标识。 */
  gateId: string;
  /** 当前读者无法访问内容时显示的文本。 */
  prompt: string;
}

/** 由附件引用持久化的属性。 */
export interface AttachmentReferenceAttributes {
  /** 稳定的附件标识。 */
  attachmentId: string;
  /** 展示用文件名。 */
  name: string;
  /** 声明的 MIME 类型。 */
  mimeType: string;
  /** 文件大小（字节）。 */
  size: number;
  /** 以论坛金币计价的购买价格。 */
  priceCoins: number;
}

/** 在 API 数据填充（hydration）之前用于乐观展示的持久化投票选项。 */
export interface PollOptionReference {
  /** 稳定的选项标识。 */
  id: string;
  /** 选项标签。 */
  label: string;
}

/** 由投票引用持久化的属性。 */
export interface PollReferenceAttributes {
  /** 稳定的投票标识。 */
  pollId: string;
  /** 随文章内联展示的投票问题。 */
  question: string;
  /** 投票者是否可以选择多个选项。 */
  multiple: boolean;
  /** 在加载到最新投票状态之前使用的稳定选项。 */
  options: readonly PollOptionReference[];
}

/** 与 JSON 路径关联的净化器或校验器问题。 */
export interface DocumentValidationIssue {
  /** 机器可读的问题类别。 */
  code:
    | "invalid-document"
    | "invalid-structure"
    | "unknown-node"
    | "unknown-mark"
    | "unknown-attribute"
    | "invalid-attribute"
    | "unsafe-url"
    | "limit-exceeded";
  /** 问题的类 JSON 路径位置。 */
  path: string;
  /** 适合诊断用的人类可读说明。 */
  message: string;
}

/** 文档校验返回的结果。 */
export interface DocumentValidationResult {
  /** 仅在未删除或未归一化任何内容时为 `true`。 */
  valid: boolean;
  /** 始终可渲染或可传递给 Tiptap 的安全文档。 */
  document: JSONContent;
  /** 有序的校验与净化诊断信息。 */
  issues: readonly DocumentValidationIssue[];
}

/** 由长文本章节块持久化的属性。 */
export interface LongTextBlockAttributes {
  /** 稳定的章节标识。 */
  chapterId: string;
  /** 章节标题。 */
  title: string;
  /** 所属卷标题；空字符串表示没有卷层级。 */
  volumeTitle: string;
  /** 完整章节文本。 */
  text: string;
  /** 小说内部的展示顺序。 */
  order: number;
  /** 在导入原文中的起始偏移；手动添加的章节为 null。 */
  start: number | null;
  /** 在导入原文中的结束偏移（不含）；手动添加的章节为 null。 */
  end: number | null;
}
