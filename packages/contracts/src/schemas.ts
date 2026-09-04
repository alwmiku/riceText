import { z } from "zod";

/** 编辑器对外提供的三种布局模式。 */
export const EditorModeSchema = z.enum(["compact", "full", "mobile"]);
/** 编辑器布局模式。 */
export type EditorMode = z.infer<typeof EditorModeSchema>;

/** API 中允许使用的稳定实体标识。 */
export const EntityIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    "标识只能包含字母、数字、下划线和连字符",
  );

/** 可安全放进 Tiptap JSON 属性中的 JSON 值。 */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Tiptap mark 的最小、可传输表示。 */
export interface TiptapMark {
  /** mark 名称，例如 bold、link 或 textStyle。 */
  type: string;
  /** 仅包含 JSON 值的受控属性。 */
  attrs?: Record<string, JsonValue> | undefined;
}

/** Tiptap 节点的最小、可传输表示。 */
export interface TiptapNode {
  /** 节点名称，例如 paragraph、text 或 richImage。 */
  type: string;
  /** 节点属性；具体白名单由 editor-core 与 API 共同约束。 */
  attrs?: Record<string, JsonValue> | undefined;
  /** 递归子节点。 */
  content?: TiptapNode[] | undefined;
  /** 应用于当前节点的 marks。 */
  marks?: TiptapMark[] | undefined;
  /** 仅 text 节点允许携带的文本。 */
  text?: string | undefined;
}

/** 任意递归 JSON 值的运行时校验器。 */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

/** Tiptap mark 的运行时校验器。 */
export const TiptapMarkSchema: z.ZodType<TiptapMark> = z
  .object({
    type: z.string().min(1).max(64),
    attrs: z.record(z.string(), JsonValueSchema).optional(),
  })
  .strict();

/** Tiptap 节点的递归运行时校验器。 */
export const TiptapNodeSchema: z.ZodType<TiptapNode> = z.lazy(() =>
  z
    .object({
      type: z.string().min(1).max(64),
      attrs: z.record(z.string(), JsonValueSchema).optional(),
      content: z.array(TiptapNodeSchema).max(20_000).optional(),
      marks: z.array(TiptapMarkSchema).max(64).optional(),
      text: z.string().max(2_000_000).optional(),
    })
    .strict(),
);

/** 服务端接受和返回的唯一正文格式。 */
export const TiptapDocumentSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(TiptapNodeSchema).max(20_000).default([]),
  })
  .strict();
/** 经过结构校验的 Tiptap 文档。 */
export type TiptapDocument = z.infer<typeof TiptapDocumentSchema>;

/** RFC 3339 时间字符串。 */
export const DateTimeSchema = z.string().datetime({ offset: true });

/** 当前文档及其乐观并发修订信息。 */
export const DocumentEnvelopeSchema = z
  .object({
    id: EntityIdSchema,
    title: z.string().min(1).max(200),
    schemaVersion: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    savedAt: DateTimeSchema,
    content: TiptapDocumentSchema,
  })
  .strict();
/** 当前文档快照。 */
export type DocumentEnvelope = z.infer<typeof DocumentEnvelopeSchema>;

/** 登录用户文章选择器使用的轻量摘要。 */
export const DocumentListItemSchema = z
  .object({
    id: EntityIdSchema,
    title: z.string().min(1).max(200),
    revision: z.number().int().nonnegative(),
    savedAt: DateTimeSchema,
    canEdit: z.boolean(),
  })
  .strict();
export type DocumentListItem = z.infer<typeof DocumentListItemSchema>;

/** 写入文档时固定使用的乐观并发请求体。 */
export const UpdateDocumentRequestSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    baseRevision: z.number().int().nonnegative(),
    clientMutationId: EntityIdSchema,
    /** baseRevision=0 且文档不存在时作为首次创建标题。 */
    title: z.string().trim().min(1).max(200).optional(),
    content: TiptapDocumentSchema,
    /** 可选：本次编辑的章节 id，保存成功后该章节 revision 递增。 */
    chapterId: EntityIdSchema.optional(),
  })
  .strict();
/** 文档写入请求。 */
export type UpdateDocumentRequest = z.infer<typeof UpdateDocumentRequestSchema>;

/** ProseMirror transaction step 的 JSON 表示。 */
export const ProseMirrorStepSchema = z.record(z.string(), JsonValueSchema);
/** ProseMirror transaction step 的传输类型。 */
export type ProseMirrorStep = z.infer<typeof ProseMirrorStepSchema>;

/** 使用 ProseMirror steps 增量更新文档的请求体。 */
export const UpdateDocumentStepsRequestSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    baseRevision: z.number().int().nonnegative(),
    clientMutationId: EntityIdSchema,
    steps: z.array(ProseMirrorStepSchema).min(1).max(1_000),
    /** 可选：本次编辑的章节 id，steps 应用成功后该章节 revision 递增。 */
    chapterId: EntityIdSchema.optional(),
  })
  .strict();
/** 增量更新文档请求。 */
export type UpdateDocumentStepsRequest = z.infer<
  typeof UpdateDocumentStepsRequestSchema
>;

/** 不可变历史版本的摘要。 */
export const RevisionSummarySchema = z
  .object({
    revision: z.number().int().nonnegative(),
    schemaVersion: z.number().int().positive(),
    savedAt: DateTimeSchema,
    authorId: EntityIdSchema,
    authorName: z.string(),
    operation: z.enum(["seed", "update", "rollback", "suggestion", "steps"]),
    summary: z.string(),
    /** 本次修订应用的 steps 的人类可读描述（快照修订为 null）。 */
    stepsSummary: z.string().nullable(),
    targetRevision: z.number().int().nonnegative().nullable(),
  })
  .strict();
/** 历史版本摘要。 */
export type RevisionSummary = z.infer<typeof RevisionSummarySchema>;

/** 游标分页查询参数。 */
export const CursorQuerySchema = z
  .object({
    cursor: z.string().min(1).max(256).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

/** 版本历史查询；chapterId 存在时只返回该章实际变化的版本。 */
export const RevisionQuerySchema = CursorQuerySchema.extend({
  cursor: z.string().regex(/^[1-9]\d*$/, "版本 cursor 必须是正整数 revision").optional(),
  chapterId: EntityIdSchema.optional(),
}).strict();

/** 通用游标分页信息。 */
export const PageInfoSchema = z
  .object({ nextCursor: z.string().nullable() })
  .strict();

/** 历史版本分页结果。 */
export const RevisionPageSchema = z
  .object({
    items: z.array(RevisionSummarySchema),
    pageInfo: PageInfoSchema,
  })
  .strict();
/** 历史版本分页结果。 */
export type RevisionPage = z.infer<typeof RevisionPageSchema>;

/** 回滚会创建新版本，而不会删除旧版本。 */
export const RollbackDocumentRequestSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    targetRevision: z.number().int().nonnegative(),
    clientMutationId: EntityIdSchema,
  })
  .strict();
/** 文档回滚请求。 */
export type RollbackDocumentRequest = z.infer<
  typeof RollbackDocumentRequestSchema
>;

/** 统一 API 错误响应。 */
export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        details: z.record(z.string(), JsonValueSchema).optional(),
      })
      .strict(),
  })
  .strict();
/** 统一 API 错误响应。 */
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** 已保存的本地图片元数据。 */
export const AssetSchema = z
  .object({
    id: EntityIdSchema,
    assetId: EntityIdSchema,
    fileName: z.string().min(1).max(255),
    name: z.string().min(1).max(255),
    mimeType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
    byteSize: z.number().int().positive(),
    size: z.number().int().positive(),
    url: z.string().min(1),
    createdAt: DateTimeSchema,
  })
  .strict();
/** 图片资产。 */
export type Asset = z.infer<typeof AssetSchema>;

/** 新建骰子所需参数。 */
export const CreateDiceRollRequestSchema = z
  .object({
    expression: z.string().trim().min(2).max(120),
    rerollOf: EntityIdSchema.nullable().optional(),
  })
  .strict();
/** 骰子投掷结果；同一 rollId 始终返回相同数据。 */
export const DiceRollSchema = z
  .object({
    rollId: EntityIdSchema,
    rootRollId: EntityIdSchema,
    rerollOf: EntityIdSchema.nullable(),
    expression: z.string(),
    rolls: z.array(z.number().finite()).max(1_000),
    total: z.number().finite(),
    createdAt: DateTimeSchema,
  })
  .strict();
/** 持久化骰子投掷。 */
export type DiceRollResult = z.infer<typeof DiceRollSchema>;

/** 间贴排序方式。 */
export const CommentSortSchema = z.enum(["score", "newest"]);
/** 新增间贴回复的请求体。 */
export const CreateCommentReplyRequestSchema = z
  .object({
    parentId: EntityIdSchema.nullable().default(null),
    body: z.string().trim().min(1).max(10_000),
  })
  .strict();
/** 间贴赞踩请求；0 表示撤销。 */
export const VoteCommentRequestSchema = z
  .object({ value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) })
  .strict();

/** 树状间贴回复。 */
export interface CommentReply {
  /** 稳定回复 ID。 */
  id: string;
  /** 父回复 ID；null 表示间贴根回复。 */
  parentId: string | null;
  /** 已裁剪到显示所需字段的作者信息。 */
  author: {
    id: string;
    name: string;
    role: "author" | "reader" | "moderator";
    avatar: string;
    coins: number;
    replied: boolean;
  };
  /** 纯文本回复正文。 */
  body: string;
  /** 点赞减点踩后的排序分。 */
  score: number;
  /** 当前查看者在服务端记录的投票。 */
  viewerVote: -1 | 0 | 1;
  /** 点赞总数。 */
  upvotes: number;
  /** 点踩总数。 */
  downvotes: number;
  /** Web 界面组件兼容字段，与 viewerVote 保持一致。 */
  myVote: -1 | 0 | 1;
  /** RFC 3339 创建时间。 */
  createdAt: string;
  /** 已按同一排序规则组装的后代。 */
  children: CommentReply[];
}
/** 树状间贴回复的运行时校验器。 */
export const CommentReplySchema: z.ZodType<CommentReply> = z.lazy(() =>
  z
    .object({
      id: EntityIdSchema,
      parentId: EntityIdSchema.nullable(),
      author: z
        .object({
          id: EntityIdSchema,
          name: z.string(),
          role: z.enum(["author", "reader", "moderator"]),
          avatar: z.string(),
          coins: z.number().int(),
          replied: z.boolean(),
        })
        .strict(),
      body: z.string(),
      score: z.number().int(),
      viewerVote: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
      upvotes: z.number().int().nonnegative(),
      downvotes: z.number().int().nonnegative(),
      myVote: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
      createdAt: DateTimeSchema,
      children: z.array(CommentReplySchema),
    })
    .strict(),
);

/** 单个段落首/尾锚点的间贴树。 */
export const CommentThreadSchema = z
  .object({
    documentId: EntityIdSchema,
    anchorId: EntityIdSchema,
    archived: z.boolean(),
    total: z.number().int().nonnegative(),
    items: z.array(CommentReplySchema),
    pageInfo: PageInfoSchema,
  })
  .strict();
/** 间贴树响应。 */
export type CommentThread = z.infer<typeof CommentThreadSchema>;

/** 论坛身份。 */
export const ForumUserSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().min(1),
    role: z.enum(["author", "reader", "moderator"]),
    isFriend: z.boolean(),
    bio: z.string(),
  })
  .strict();
/** 论坛身份。 */
export type ForumUser = z.infer<typeof ForumUserSchema>;

/** 登录会话中的论坛身份，包含当前余额和回复解锁状态。 */
export const ForumSessionUserSchema = ForumUserSchema.extend({
  avatar: z.string().min(1).max(8),
  coins: z.number().int().nonnegative(),
  replied: z.boolean(),
}).strict();
export type ForumSessionUser = z.infer<typeof ForumSessionUserSchema>;

export const ForumSessionSchema = z
  .object({
    current: ForumSessionUserSchema,
    available: z.array(ForumSessionUserSchema),
  })
  .strict();
export type ForumSession = z.infer<typeof ForumSessionSchema>;

/** Cloudflare Workers 生产运行时允许的 PBKDF2 最大迭代次数。 */
export const PASSWORD_HASH_ITERATIONS = 100_000;

/** 本地账号密码登录；生产只通过 HTTPS 发送，服务端不保存明文密码。 */
export const PasswordLoginRequestSchema = z
  .object({
    username: z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9._-]+$/),
    password: z.string().min(10).max(128),
  })
  .strict();
export type PasswordLoginRequest = z.infer<typeof PasswordLoginRequestSchema>;

/** 章节目录项。 */
export const ChapterSchema = z
  .object({
    id: EntityIdSchema,
    title: z.string(),
    order: z.number().int().nonnegative(),
    documentId: EntityIdSchema,
    /** 该章节独立的保存版本号。 */
    revision: z.number().int().nonnegative(),
    /** 该章节最近一次由服务器确认的保存时间。 */
    savedAt: DateTimeSchema,
    /** 隐藏章节：读者不可读，作者写完取消隐藏后恢复可读。 */
    hidden: z.boolean(),
  })
  .strict();
/** 分章上传后的单章正文；阅读页按需读取，避免下载整部长文本。 */
export const ChapterContentSchema = ChapterSchema.extend({
  content: TiptapDocumentSchema,
}).strict();
export type ChapterContent = z.infer<typeof ChapterContentSchema>;
/** 章节差异同步清单中的单个本地章节。 */
export const ChapterSyncItemSchema = z
  .object({
    id: EntityIdSchema,
    title: z.string().min(1).max(500),
    order: z.number().int().nonnegative(),
    /** 章节正文的 SHA-256 十六进制摘要。 */
    hash: z.string().min(1).max(128),
  })
  .strict();
/** 章节差异同步请求体。 */
export const SyncNovelChaptersRequestSchema = z
  .object({ chapters: z.array(ChapterSyncItemSchema).max(10_000).default([]) })
  .strict();
/** 章节差异同步响应：需要上传与无需上传（已存在）的章节 ID。 */
export const SyncNovelChaptersResponseSchema = z
  .object({
    toUpdate: z.array(EntityIdSchema),
    existing: z.array(EntityIdSchema),
  })
  .strict();

/** 保存单个章节内容的请求体。 */
export const SaveNovelChapterRequestSchema = z
  .object({
    title: z.string().min(1).max(500),
    order: z.number().int().nonnegative(),
    content: TiptapDocumentSchema,
    /** 保存正文的 SHA-256 摘要，用于后续差异对比。 */
    hash: z.string().min(1).max(128),
    /** 该章节独立的保存版本号，冲突时返回 409。 */
    baseRevision: z.number().int().nonnegative(),
  })
  .strict();

/** 批量章节保存请求中的单个章节（正文与单章 PUT 完全一致）。 */
export const BatchChapterItemSchema = z
  .object({
    id: EntityIdSchema,
    title: z.string().min(1).max(500),
    order: z.number().int().nonnegative(),
    content: TiptapDocumentSchema,
    /** 保存正文的 SHA-256 摘要；服务端以它识别“内容未变化”的幂等重试。 */
    hash: z.string().min(1).max(128),
    /** 该章节独立的保存版本号，整批任一过期时整批返回 409。 */
    baseRevision: z.number().int().nonnegative(),
  })
  .strict();
/** 批量章节保存请求项。 */
export type BatchChapterItem = z.infer<typeof BatchChapterItemSchema>;

/**
 * 批量保存章节正文：每批最多 20 章（与 D1 Free 每次 Worker 调用 50 条查询
 * 上限对齐：1 条文档查询 + 1 条元数据查询 + 最多 20 条 UPSERT）。
 * 正文总序列化大小由客户端按 4 MiB 切批，路由另设约 5 MiB 上限。
 */
export const SaveNovelChaptersBatchRequestSchema = z
  .object({ chapters: z.array(BatchChapterItemSchema).min(1).max(20) })
  .strict();
/** 批量章节保存请求。 */
export type SaveNovelChaptersBatchRequest = z.infer<
  typeof SaveNovelChaptersBatchRequestSchema
>;

/** 批量保存响应中的单个章节结果。 */
export const SaveNovelChaptersBatchItemResponseSchema = z
  .object({
    id: EntityIdSchema,
    title: z.string().min(1).max(500),
    order: z.number().int().nonnegative(),
    /** 保存后的章节独立版本号；unchanged 时返回服务端当前版本。 */
    revision: z.number().int().nonnegative(),
    /**
     * saved = 本次实际写入；unchanged = 服务端 content_hash 与请求 hash
     * 一致（含上次响应丢失后的幂等重试），未重复递增版本号。
     */
    status: z.enum(["saved", "unchanged"]),
  })
  .strict();
/** 批量保存响应中的单个章节结果。 */
export type SaveNovelChaptersBatchItemResponse = z.infer<
  typeof SaveNovelChaptersBatchItemResponseSchema
>;

/** 批量章节保存响应：与请求顺序一致。 */
export const SaveNovelChaptersBatchResponseSchema = z
  .object({
    chapters: z.array(SaveNovelChaptersBatchItemResponseSchema).min(1).max(20),
  })
  .strict();
/** 批量章节保存响应。 */
export type SaveNovelChaptersBatchResponse = z.infer<
  typeof SaveNovelChaptersBatchResponseSchema
>;

/** 创建整本上传会话；manifestHash 覆盖有序的 id/title/order/hash 清单。 */
export const CreateChapterUploadRequestSchema = z
  .object({
    manifestHash: z.string().regex(/^[0-9a-f]{64}$/),
    totalChapters: z.number().int().min(1).max(10_000),
  })
  .strict();
export const ChapterUploadSessionSchema = z
  .object({
    uploadId: EntityIdSchema,
    manifestHash: z.string().regex(/^[0-9a-f]{64}$/),
    totalChapters: z.number().int().min(1).max(10_000),
    status: z.enum(["uploading", "published"]),
    staged: z.array(EntityIdSchema),
  })
  .strict();
export const StageChapterUploadBatchRequestSchema = z
  .object({ chapters: z.array(BatchChapterItemSchema).min(1).max(20) })
  .strict();
export const StageChapterUploadBatchResponseSchema =
  SaveNovelChaptersBatchResponseSchema;
export const CompleteChapterUploadResponseSchema = z
  .object({
    uploadId: EntityIdSchema,
    manifestHash: z.string().regex(/^[0-9a-f]{64}$/),
    totalChapters: z.number().int().min(1).max(10_000),
    publishedAt: DateTimeSchema,
  })
  .strict();

/** 换序暂存请求中的单个章节（仅携带轻量元数据，不发送正文）。 */
export const StageChapterReorderItemSchema = z
  .object({
    id: EntityIdSchema,
    /** 全局唯一的临时 order；客户端取“当前最大服务器 order + 顺序号”。 */
    temporaryOrder: z.number().int().nonnegative(),
    /** 该章节独立的保存版本号；过期时整批返回 409。 */
    baseRevision: z.number().int().nonnegative(),
  })
  .strict();
/** 换序暂存请求项。 */
export type StageChapterReorderItem = z.infer<
  typeof StageChapterReorderItemSchema
>;

/**
 * 换序暂存：每批最多 40 项（1 条文档查询 + 1 条元数据查询 + 最多 40 条
 * UPDATE 仍在 D1 Free 50 条查询上限内）。仅在确有换序时调用。
 */
export const StageNovelChapterReorderRequestSchema = z
  .object({ chapters: z.array(StageChapterReorderItemSchema).min(1).max(40) })
  .strict();
/** 换序暂存请求。 */
export type StageNovelChapterReorderRequest = z.infer<
  typeof StageNovelChapterReorderRequestSchema
>;

/** 换序暂存响应中的单个章节结果。 */
export const StageNovelChapterReorderItemResponseSchema = z
  .object({
    id: EntityIdSchema,
    /** 暂存后的章节独立版本号。 */
    revision: z.number().int().nonnegative(),
    /**
     * staged = 本次把位置改到临时 order（含上次响应丢失后的幂等重试）；
     * unchanged = 当前顺序已经等于临时顺序，未重复递增版本号。
     */
    status: z.enum(["staged", "unchanged"]),
  })
  .strict();
/** 换序暂存响应中的单个章节结果。 */
export type StageNovelChapterReorderItemResponse = z.infer<
  typeof StageNovelChapterReorderItemResponseSchema
>;

/** 换序暂存响应：与请求顺序一致。 */
export const StageNovelChapterReorderResponseSchema = z
  .object({
    chapters: z.array(StageNovelChapterReorderItemResponseSchema).min(1).max(40),
  })
  .strict();
/** 换序暂存响应。 */
export type StageNovelChapterReorderResponse = z.infer<
  typeof StageNovelChapterReorderResponseSchema
>;
/** 新增章节请求：编辑器保存前把正文中已出现但服务器目录缺失的新章节注册进目录。 */
export const CreateDocumentChapterRequestSchema = z
  .object({
    title: z.string().min(1).max(500),
    order: z.number().int().nonnegative(),
  })
  .strict();
/** 新增章节请求。 */
export type CreateDocumentChapterRequest = z.infer<
  typeof CreateDocumentChapterRequestSchema
>;

/** 更新章节目录行（隐藏/恢复可读）的请求体。 */
export const UpdateDocumentChapterRequestSchema = z
  .object({
    hidden: z.boolean(),
  })
  .strict();
/** 更新章节目录行的请求。 */
export type UpdateDocumentChapterRequest = z.infer<
  typeof UpdateDocumentChapterRequestSchema
>;

/** 删除章节目录行后的响应（幂等：未命中时 deleted = false）。 */
export const DeleteDocumentChapterResponseSchema = z
  .object({
    id: EntityIdSchema,
    deleted: z.boolean(),
  })
  .strict();
/** 删除章节目录行后的响应。 */
export type DeleteDocumentChapterResponse = z.infer<
  typeof DeleteDocumentChapterResponseSchema
>;

/** 保存章节后的版本摘要（不重复传输正文）。 */
export const SaveNovelChapterResponseSchema = z
  .object({
    id: EntityIdSchema,
    title: z.string().min(1).max(500),
    order: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
/** 章节目录项类型。 */
export type Chapter = z.infer<typeof ChapterSchema>;

/** 纠错建议。 */
export const SuggestionSchema = z
  .object({
    id: EntityIdSchema,
    documentId: EntityIdSchema,
    /** 校订针对的章节（与章节目录 chapters.id 一致）；空串表示未定位到章节。 */
    chapterId: z.string(),
    /** 章节标题（冗余存储，免联表即可展示“对哪一章校订”）。 */
    chapterTitle: z.string(),
    /** 校订在章节内的行号（1-based；0 表示未知）。 */
    lineNo: z.number().int().nonnegative(),
    /** 该行完整文本，作为行级定位依据。 */
    lineText: z.string(),
    fromText: z.string(),
    toText: z.string(),
    reason: z.string(),
    status: z.enum(["pending", "approved", "rejected"]),
    authorId: EntityIdSchema,
    reviewerId: EntityIdSchema.nullable(),
    createdAt: DateTimeSchema,
  })
  .strict();
/** 纠错建议类型。 */
export type Suggestion = z.infer<typeof SuggestionSchema>;

/** 读者提交纠错建议的请求体。 */
export const CreateSuggestionRequestSchema = z
  .object({
    fromText: z.string().min(1),
    /** 空字符串表示删除所选原文。 */
    toText: z.string(),
    reason: z.string().max(500).default(""),
    /** 校订定位：章节 ID 与行信息；旧客户端可不传，服务端按默认值存储。 */
    chapterId: z.string().default(""),
    chapterTitle: z.string().default(""),
    lineNo: z.number().int().nonnegative().default(0),
    lineText: z.string().default(""),
  })
  .strict();
/** 作者或版主审核纠错建议的请求体。 */
export const ReviewSuggestionRequestSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    baseRevision: z.number().int().nonnegative(),
  })
  .strict();

/** 整章多处修改合并成的一次批量校订。 */
export const SuggestionBatchSchema = z
  .object({
    id: EntityIdSchema,
    documentId: EntityIdSchema,
    chapterId: z.string(),
    chapterTitle: z.string(),
    baseRevision: z.number().int().nonnegative(),
    beforeContent: TiptapDocumentSchema,
    afterContent: TiptapDocumentSchema,
    steps: z.array(ProseMirrorStepSchema).min(1).max(1_000),
    reason: z.string(),
    status: z.enum(["pending", "approved", "rejected"]),
    authorId: EntityIdSchema,
    reviewerId: EntityIdSchema.nullable(),
    createdAt: DateTimeSchema,
  })
  .strict();
export type SuggestionBatch = z.infer<typeof SuggestionBatchSchema>;

/** 读者提交整章批量校订的请求。 */
export const CreateSuggestionBatchRequestSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    chapterId: z.string().min(1),
    chapterTitle: z.string().min(1),
    beforeContent: TiptapDocumentSchema,
    afterContent: TiptapDocumentSchema,
    steps: z.array(ProseMirrorStepSchema).min(1).max(1_000),
    reason: z.string().max(500).default(""),
  })
  .strict();

/** 作者或版主原子审核一个批量校订。 */
export const ReviewSuggestionBatchRequestSchema = ReviewSuggestionRequestSchema;

/** @ 搜索结果。 */
export const MentionSearchResultSchema = z
  .object({ items: z.array(ForumUserSchema) })
  .strict();
/** 服务端解析非好友 @ 的请求体。 */
export const ResolveMentionRequestSchema = z
  .object({
    name: z.string().min(1).max(80),
    userId: EntityIdSchema.optional(),
  })
  .strict();
/** @ 解析结果。 */
export const ResolveMentionResponseSchema = z
  .object({
    resolved: z.boolean(),
    displayText: z.string(),
    user: ForumUserSchema.nullable(),
  })
  .strict();

/** 回复可见内容解析请求。 */
export const ResolveReplyGateRequestSchema = z
  .object({ gateId: EntityIdSchema, documentId: EntityIdSchema })
  .strict();
/** 回复可见内容解析结果。 */
export const ResolveReplyGateResponseSchema = z
  .object({
    visible: z.boolean(),
    content: TiptapDocumentSchema.nullable(),
    message: z.string(),
  })
  .strict();

/** 附件与购买条件。 */
export const AttachmentSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string(),
    mimeType: z.string(),
    price: z.number().int().nonnegative(),
    purchased: z.boolean(),
    downloadUrl: z.string().nullable(),
  })
  .strict();
/** 附件类型。 */
export type Attachment = z.infer<typeof AttachmentSchema>;

/** 附件购买结果。 */
export const PurchaseAttachmentResponseSchema = z
  .object({
    attachment: AttachmentSchema,
    buyerBalance: z.number().int(),
    authorIncome: z.number().int(),
    alreadyPurchased: z.boolean(),
  })
  .strict();

/** 投票选项和统计。 */
export const PollOptionSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string(),
    votes: z.number().int().nonnegative(),
  })
  .strict();
/** 投票详情。 */
export const PollSchema = z
  .object({
    id: EntityIdSchema,
    question: z.string(),
    multiple: z.boolean(),
    eligible: z.boolean(),
    options: z.array(PollOptionSchema),
    viewerOptionIds: z.array(EntityIdSchema),
  })
  .strict();
/** 投票详情类型。 */
export type Poll = z.infer<typeof PollSchema>;

/** 提交投票的请求体。 */
export const SubmitPollVoteRequestSchema = z
  .object({ optionIds: z.array(EntityIdSchema).min(1).max(10) })
  .strict();
/** 实名投票记录。 */
export const PollVoteSchema = z
  .object({
    user: ForumUserSchema,
    optionIds: z.array(EntityIdSchema),
    createdAt: DateTimeSchema,
  })
  .strict();
/** 实名投票记录分页结果。 */
export const PollVotePageSchema = z
  .object({ items: z.array(PollVoteSchema), pageInfo: PageInfoSchema })
  .strict();

/** 图片上传适配器，方便将本地 API 替换为对象存储。 */
export interface AssetAdapter {
  upload(file: File, signal?: AbortSignal): Promise<Asset>;
}
/** 骰子适配器，保证只有显式 reroll 才产生新结果。 */
export interface DiceAdapter {
  create(expression: string, signal?: AbortSignal): Promise<DiceRollResult>;
  reroll(rollId: string, signal?: AbortSignal): Promise<DiceRollResult>;
}
/** 间贴适配器。 */
export interface CommentAdapter {
  getThread(
    documentId: string,
    anchorId: string,
    sort: z.infer<typeof CommentSortSchema>,
    cursor?: string,
  ): Promise<CommentThread>;
  reply(
    documentId: string,
    anchorId: string,
    body: string,
    parentId?: string,
  ): Promise<CommentReply>;
  vote(
    replyId: string,
    value: -1 | 0 | 1,
  ): Promise<{ score: number; viewerVote: -1 | 0 | 1 }>;
}
/** 论坛业务能力的可替换适配器。 */
export interface ForumBusinessAdapter {
  searchUsers(query: string, friendsOnly?: boolean): Promise<ForumUser[]>;
  resolveMention(
    name: string,
    userId?: string,
  ): Promise<z.infer<typeof ResolveMentionResponseSchema>>;
  purchaseAttachment(
    id: string,
  ): Promise<z.infer<typeof PurchaseAttachmentResponseSchema>>;
  vote(
    pollId: string,
    optionIds: string[],
  ): Promise<z.infer<typeof PollSchema>>;
}
