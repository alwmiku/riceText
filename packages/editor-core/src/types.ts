import type { JSONContent } from '@tiptap/core'

/** 当前持久化的 Tiptap JSON schema 版本。 */
export const EDITOR_SCHEMA_VERSION = 1 as const

/** 共享编辑器外壳使用的布局预设。 */
export type EditorMode = 'compact' | 'full' | 'mobile'

/** 上传二进制资源后返回的元数据。 */
export interface UploadedAsset {
  /** 稳定的服务端资源标识。 */
  assetId: string
  /** 由应用提供的安全 URL。 */
  url: string
  /** 原始文件名。 */
  name: string
  /** 服务端接受的 MIME 类型。 */
  mimeType: string
  /** 持久化的大小（字节）。 */
  size: number
}

/** 编辑器与资源 API 之间可替换的桥接层。 */
export interface AssetAdapter {
  /** 上传二进制文件而不将其嵌入文档 JSON。 */
  upload(file: File, signal?: AbortSignal): Promise<UploadedAsset>
}

/** 编辑器与不可变骰子 API 之间可替换的桥接层。 */
export interface DiceAdapter {
  /** 为骰子表达式创建并持久化一次新的掷骰。 */
  roll(expression: string, signal?: AbortSignal): Promise<DiceRollAttributes>
  /** 创建一次关联到所提供持久化掷骰的新掷骰。 */
  reroll(rollId: string, signal?: AbortSignal): Promise<DiceRollAttributes>
}

/** 由会话（thread）适配器与查看器集成共享的最小评论条目。 */
export interface InlineCommentItem {
  /** 稳定的回复标识。 */
  id: string
  /** 父回复标识；根回复为 `null`。 */
  parentId: string | null
  /** 作者显示名。 */
  authorName: string
  /** 纯文本回复正文。 */
  body: string
  /** 当前赞数减去踩数。 */
  score: number
  /** ISO-8601 格式的创建时间戳。 */
  createdAt: string
}

/** 用于懒加载行内评论树的可替换桥接层。 */
export interface InlineCommentAdapter {
  /** 加载会话（thread）的一页游标数据。 */
  loadThread(threadId: string, cursor?: string, signal?: AbortSignal): Promise<{ items: readonly InlineCommentItem[]; nextCursor: string | null }>
  /** 向会话（thread）或另一条回复添加回复。 */
  reply(threadId: string, body: string, parentId?: string): Promise<InlineCommentItem>
  /** 设置当前用户的投票；0 表示取消投票。 */
  vote(threadId: string, replyId: string, value: -1 | 0 | 1): Promise<{ score: number; viewerVote: -1 | 0 | 1 }>
}

/** 好友或服务端用户搜索返回的提及候选。 */
export interface MentionCandidate {
  /** 稳定的用户标识。 */
  userId: string
  /** 显示名。 */
  name: string
  /** 可选的安全头像 URL。 */
  avatarUrl: string | null
  /** 该用户是否已是当前身份的好友。 */
  isFriend: boolean
}

/** 用于首发版本模拟业务流程的可替换桥接层。 */
export interface ForumFeatureAdapter {
  /** 针对 `@` 查询搜索本地好友与服务端用户。 */
  searchMentions(query: string, signal?: AbortSignal): Promise<readonly MentionCandidate[]>
  /** 在发布前解析用户输入的提及。 */
  resolveMention(nameOrId: string, signal?: AbortSignal): Promise<MentionAttributes>
  /** 在成功回复后请求访问回复门控块。 */
  unlockReplyGate(gateId: string): Promise<{ visible: boolean }>
  /** 根据服务端策略购买或下载附件。 */
  activateAttachment(attachmentId: string): Promise<{ downloadUrl: string | null; balance: number }>
  /** 投出或替换当前身份的投票。 */
  vote(pollId: string, optionIds: readonly string[]): Promise<void>
}

/** 为查看器图库归一化的富图片。 */
export interface ViewerImage extends RichImageAttributes {
  /** 在此文档图片图库中的从零开始的位置。 */
  index: number
}

/** 附件引用的已填充（hydrated）查看器状态。 */
export interface ViewerAttachmentState {
  /** 读者是否已拥有或可直接下载该文件。 */
  available: boolean
  /** 当前是否有一个附件请求正在进行中。 */
  pending: boolean
}

/** 投票引用的已填充（hydrated）查看器状态。 */
export interface ViewerPollState {
  /** 当前身份已选择的选项标识。 */
  selectedOptionIds: readonly string[]
  /** 按选项标识索引的票数总计。 */
  votesByOption: Readonly<Record<string, number>>
  /** 当前身份是否被允许投票。 */
  canVote: boolean
  /** 当前是否有一个投票请求正在进行中。 */
  pending: boolean
}

/** 持久化节点属性与文档校验类型统一来自 @ricetext/document-core。 */
import type {
  DiceRollAttributes,
  MentionAttributes,
  RichImageAttributes,
} from '@ricetext/document-core'

export type {
  InlineCommentPlacement,
  InlineCommentAnchorAttributes,
  RichImageAlignment,
  RichImageAttributes,
  DiceRollAttributes,
  NovelExcerptVariant,
  NovelExcerptAttributes,
  MentionAttributes,
  ReplyGateAttributes,
  AttachmentReferenceAttributes,
  PollOptionReference,
  PollReferenceAttributes,
  DocumentValidationIssue,
  DocumentValidationResult,
  LongTextBlockAttributes,
} from '@ricetext/document-core'

export type { JSONContent }
