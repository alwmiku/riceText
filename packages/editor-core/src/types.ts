import type { JSONContent } from '@tiptap/core'

/** The current persisted Tiptap JSON schema version. */
export const EDITOR_SCHEMA_VERSION = 1 as const

/** Layout preset used by the shared editor shell. */
export type EditorMode = 'compact' | 'full' | 'mobile'

/** Placement of an inline-comment counter relative to its paragraph. */
export type InlineCommentPlacement = 'start' | 'end'

/** Attributes persisted by an `inlineCommentAnchor` node. */
export interface InlineCommentAnchorAttributes {
  /** Stable server-side thread identifier. */
  threadId: string
  /** Cached reply count used before the thread is fetched. */
  count: number
  /** Whether the counter belongs at the block start or block end. */
  placement: InlineCommentPlacement
}

/** Supported block alignment for rich images. */
export type RichImageAlignment = 'left' | 'center' | 'right'

/** Attributes persisted by a `richImage` node. */
export interface RichImageAttributes {
  /** Stable uploaded asset identifier, or `null` for an external image. */
  assetId: string | null
  /** Safe HTTP(S) or same-origin upload URL. */
  src: string
  /** Alternative text used by assistive technology. */
  alt: string
  /** Optional visible image caption. */
  caption: string
  /** Block alignment in the article flow. */
  align: RichImageAlignment
  /** Width as a percentage of the available content column. */
  width: number
}

/** Immutable attributes returned by the dice API and stored in the document. */
export interface DiceRollAttributes {
  /** Stable identifier of this roll. */
  rollId: string
  /** Normalized dice notation, for example `3d5`. */
  expression: string
  /** Individual die results in evaluation order. */
  rolls: readonly number[]
  /** Persisted total; renderers must never calculate a new value. */
  total: number
  /** Previous roll identifier when this result is an explicit reroll. */
  rerollOf: string | null
}

/** Visual template used for a searchable novel excerpt. */
export type NovelExcerptVariant = 'mobile-book' | 'desktop-book' | 'forum-evidence'

/** Metadata persisted by a `novelExcerpt` block. */
export interface NovelExcerptAttributes {
  /** Source book title. */
  bookTitle: string
  /** Source chapter title. */
  chapterTitle: string
  /** Source author display name. */
  author: string
  /** Optional safe source URL. */
  sourceUrl: string | null
  /** Visual template for the excerpt. */
  variant: NovelExcerptVariant
}

/** Attributes persisted by an inline `mention` node. */
export interface MentionAttributes {
  /** Stable user identifier when resolution succeeds. */
  userId: string | null
  /** Display name typed or returned by the server. */
  name: string
  /** Whether the server resolved this mention to a user. */
  resolved: boolean
  /** Optional safe avatar URL for the hover card. */
  avatarUrl: string | null
}

/** Attributes persisted by a reply-gated content block. */
export interface ReplyGateAttributes {
  /** Stable gate identifier used to query viewer access. */
  gateId: string
  /** Text shown when the current reader cannot access the content. */
  prompt: string
}

/** Attributes persisted by an attachment reference. */
export interface AttachmentReferenceAttributes {
  /** Stable attachment identifier. */
  attachmentId: string
  /** Display file name. */
  name: string
  /** Declared MIME type. */
  mimeType: string
  /** File size in bytes. */
  size: number
  /** Purchase price in forum coins. */
  priceCoins: number
}

/** A persisted poll choice used for optimistic display before API hydration. */
export interface PollOptionReference {
  /** Stable option identifier. */
  id: string
  /** Option label. */
  label: string
}

/** Attributes persisted by a poll reference. */
export interface PollReferenceAttributes {
  /** Stable poll identifier. */
  pollId: string
  /** Poll question shown inline with the article. */
  question: string
  /** Whether a voter may choose more than one option. */
  multiple: boolean
  /** Stable options used until fresh poll state is loaded. */
  options: readonly PollOptionReference[]
}

/** Sanitizer or validator issue tied to a JSON path. */
export interface DocumentValidationIssue {
  /** Machine-readable issue category. */
  code: 'invalid-document' | 'invalid-structure' | 'unknown-node' | 'unknown-mark' | 'unknown-attribute' | 'invalid-attribute' | 'unsafe-url' | 'limit-exceeded'
  /** JSON-path-like location of the issue. */
  path: string
  /** Human-readable explanation suitable for diagnostics. */
  message: string
}

/** Result returned by document validation. */
export interface DocumentValidationResult {
  /** `true` only when no content was removed or normalized. */
  valid: boolean
  /** Safe document that can always be rendered or passed to Tiptap. */
  document: JSONContent
  /** Ordered validation and sanitization diagnostics. */
  issues: readonly DocumentValidationIssue[]
}

/** Metadata returned after uploading a binary asset. */
export interface UploadedAsset {
  /** Stable server-side asset identifier. */
  assetId: string
  /** Safe URL served by the application. */
  url: string
  /** Original file name. */
  name: string
  /** MIME type accepted by the server. */
  mimeType: string
  /** Persisted size in bytes. */
  size: number
}

/** Replaceable bridge between the editor and an asset API. */
export interface AssetAdapter {
  /** Uploads a binary file without embedding it into document JSON. */
  upload(file: File, signal?: AbortSignal): Promise<UploadedAsset>
}

/** Replaceable bridge between the editor and the immutable dice API. */
export interface DiceAdapter {
  /** Creates and persists a new roll for a dice expression. */
  roll(expression: string, signal?: AbortSignal): Promise<DiceRollAttributes>
  /** Creates a new roll linked to the supplied persisted roll. */
  reroll(rollId: string, signal?: AbortSignal): Promise<DiceRollAttributes>
}

/** Minimal comment item shared by thread adapters and viewer integrations. */
export interface InlineCommentItem {
  /** Stable reply identifier. */
  id: string
  /** Parent reply identifier, or `null` for a root reply. */
  parentId: string | null
  /** Author display name. */
  authorName: string
  /** Plain-text reply body. */
  body: string
  /** Current up-votes minus down-votes. */
  score: number
  /** ISO-8601 creation timestamp. */
  createdAt: string
}

/** Replaceable bridge for lazy inline-comment trees. */
export interface InlineCommentAdapter {
  /** Loads one cursor page of a thread. */
  loadThread(threadId: string, cursor?: string, signal?: AbortSignal): Promise<{ items: readonly InlineCommentItem[]; nextCursor: string | null }>
  /** Adds a reply to a thread or another reply. */
  reply(threadId: string, body: string, parentId?: string): Promise<InlineCommentItem>
  /** Sets the current user's vote; zero removes it. */
  vote(threadId: string, replyId: string, value: -1 | 0 | 1): Promise<{ score: number; viewerVote: -1 | 0 | 1 }>
}

/** Mention candidate returned by a friend or server-side user search. */
export interface MentionCandidate {
  /** Stable user identifier. */
  userId: string
  /** Display name. */
  name: string
  /** Optional safe avatar URL. */
  avatarUrl: string | null
  /** Whether this user is already a friend of the current identity. */
  isFriend: boolean
}

/** Replaceable bridge for first-release mock business workflows. */
export interface DemoFeatureAdapter {
  /** Searches local friends and server-side users for an `@` query. */
  searchMentions(query: string, signal?: AbortSignal): Promise<readonly MentionCandidate[]>
  /** Resolves a typed mention before publication. */
  resolveMention(nameOrId: string, signal?: AbortSignal): Promise<MentionAttributes>
  /** Requests access to a reply-gated block after a successful reply. */
  unlockReplyGate(gateId: string): Promise<{ visible: boolean }>
  /** Purchases or downloads an attachment according to server policy. */
  activateAttachment(attachmentId: string): Promise<{ downloadUrl: string | null; balance: number }>
  /** Casts or replaces the current identity's poll vote. */
  vote(pollId: string, optionIds: readonly string[]): Promise<void>
}

/** A rich image normalized for the viewer's gallery. */
export interface ViewerImage extends RichImageAttributes {
  /** Zero-based position within this document's image gallery. */
  index: number
}

/** Hydrated viewer state for an attachment reference. */
export interface ViewerAttachmentState {
  /** Whether the reader already owns or may directly download the file. */
  available: boolean
  /** Whether an attachment request is currently in flight. */
  pending: boolean
}

/** Hydrated viewer state for a poll reference. */
export interface ViewerPollState {
  /** Option identifiers selected by the current identity. */
  selectedOptionIds: readonly string[]
  /** Vote totals keyed by option identifier. */
  votesByOption: Readonly<Record<string, number>>
  /** Whether the current identity is permitted to vote. */
  canVote: boolean
  /** Whether a vote request is currently in flight. */
  pending: boolean
}
