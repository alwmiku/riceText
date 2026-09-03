import { z } from "zod";
import {
  ApiErrorSchema,
  AssetSchema,
  AttachmentSchema,
  ChapterContentSchema,
  ChapterSchema,
  CommentReplySchema,
  CommentSortSchema,
  CommentThreadSchema,
  CreateCommentReplyRequestSchema,
  CreateDiceRollRequestSchema,
  CreateDocumentChapterRequestSchema,
  CreateSuggestionBatchRequestSchema,
  CreateSuggestionRequestSchema,
  CursorQuerySchema,
  DeleteDocumentChapterResponseSchema,
  ForumSessionSchema,
  DiceRollSchema,
  DocumentEnvelopeSchema,
  DocumentListItemSchema,
  EntityIdSchema,
  MentionSearchResultSchema,
  PollSchema,
  PollVotePageSchema,
  PurchaseAttachmentResponseSchema,
  ResolveMentionRequestSchema,
  ResolveMentionResponseSchema,
  ResolveReplyGateRequestSchema,
  ResolveReplyGateResponseSchema,
  RevisionPageSchema,
  RevisionQuerySchema,
  ReviewSuggestionBatchRequestSchema,
  ReviewSuggestionRequestSchema,
  RollbackDocumentRequestSchema,
  SaveNovelChapterRequestSchema,
  SaveNovelChapterResponseSchema,
  SaveNovelChaptersBatchRequestSchema,
  SaveNovelChaptersBatchResponseSchema,
  StageNovelChapterReorderRequestSchema,
  StageNovelChapterReorderResponseSchema,
  SubmitPollVoteRequestSchema,
  SuggestionBatchSchema,
  SuggestionSchema,
  SyncNovelChaptersRequestSchema,
  SyncNovelChaptersResponseSchema,
  UpdateDocumentChapterRequestSchema,
  UpdateDocumentRequestSchema,
  UpdateDocumentStepsRequestSchema,
  VoteCommentRequestSchema,
} from "./schemas.js";

/** 契约使用的 HTTP 方法。 */
export type ContractMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** 单个状态码的响应契约。 */
export interface ContractResponse {
  /** 当前状态码的人类可读语义，会写入 OpenAPI responses。 */
  description: string;
  /** 响应体的运行时 Zod schema。 */
  schema: z.ZodType;
}

/** REST 路由的单一来源元数据。 */
export interface ContractRoute {
  /** 跨服务和生成客户端保持稳定的操作名。 */
  operationId: string;
  /** HTTP 方法。 */
  method: ContractMethod;
  /** Fastify 风格路径，其中动态段使用 `:name`。 */
  path: string;
  /** OpenAPI 列表中的短标题。 */
  summary: string;
  /** 行为、权限和失败语义的完整说明。 */
  description: string;
  /** OpenAPI 分组标签。 */
  tags: string[];
  /** 路径参数 schema。 */
  params?: z.ZodType;
  /** 查询参数 schema。 */
  query?: z.ZodType;
  /** JSON 请求体 schema；multipart 路由由生成器单独处理。 */
  body?: z.ZodType;
  /** 状态码到响应契约的映射。 */
  responses: Record<number, ContractResponse>;
  /** 实现状态用于区分已上线能力和仅规划契约。 */
  implementationStatus?: "implemented" | "planned";
}

const documentParams = z.object({ documentId: EntityIdSchema.describe("文档稳定 ID，例如 demo-post") }).strict();
const revisionParams = z.object({
  documentId: EntityIdSchema.describe("文档稳定 ID，例如 demo-post"),
  revision: z.string().regex(/^\d+$/).describe("不可变 revision 编号"),
}).strict();
const revisionQuery = RevisionQuerySchema;
const assetParams = z.object({ assetId: EntityIdSchema.describe("上传后返回的图片资产 ID") }).strict();
const diceParams = z.object({ rollId: EntityIdSchema.describe("首次投掷或重投生成的稳定 rollId") }).strict();
const threadParams = z.object({ documentId: EntityIdSchema, anchorId: EntityIdSchema }).strict();
const commentQuery = CursorQuerySchema.extend({ sort: CommentSortSchema.default("score") }).strict();
const replyParams = z.object({ replyId: EntityIdSchema }).strict();
const suggestionParams = z.object({ suggestionId: EntityIdSchema }).strict();
const suggestionBatchParams = z.object({ batchId: EntityIdSchema }).strict();
const userSearchQuery = z.object({ q: z.string().max(80).default(""), friendsOnly: z.coerce.boolean().default(false) }).strict();
const attachmentParams = z.object({ attachmentId: EntityIdSchema }).strict();
const pollParams = z.object({ pollId: EntityIdSchema }).strict();
const novelParams = z.object({ novelId: EntityIdSchema.describe("章节所属的文档/小说 ID") }).strict();
const novelChapterParams = z.object({ novelId: EntityIdSchema, chapterId: EntityIdSchema }).strict();
const documentChapterParams = z.object({ documentId: EntityIdSchema, chapterId: EntityIdSchema }).strict();
const documentQuery = z.object({ documentId: EntityIdSchema }).strict();

/** 全部REST 契约；OpenAPI 和 Fastify schema 均由此生成。 */
export const contractRoutes: readonly ContractRoute[] = [
  {
    operationId: "listDocuments", method: "GET", path: "/api/documents", tags: ["文档"],
    summary: "读取可选文章", description: "仅登录用户可用；返回可读取文章并标记当前身份是否有编辑权。",
    responses: { 200: { description: "按更新时间倒序的文章摘要。", schema: z.object({ items: z.array(DocumentListItemSchema) }).strict() }, 401: { description: "游客不能读取服务器文章列表。", schema: ApiErrorSchema } },
  },
  {
    operationId: "getDocument", method: "GET", path: "/api/documents/:documentId", tags: ["文档"],
    summary: "读取当前文档", description: "仅登录用户读取最新不可变修订；非编辑者看不到隐藏章节。",
    params: documentParams,
    responses: { 200: { description: "当前文档，例如 revision 为 1 的 demo-post。", schema: DocumentEnvelopeSchema }, 404: { description: "文档不存在。", schema: ApiErrorSchema } },
  },
  {
    operationId: "updateDocument", method: "PUT", path: "/api/documents/:documentId", tags: ["文档"],
    summary: "保存或首次创建文档", description: "需要 author 或 moderator。文档不存在且 baseRevision=0 时创建文档、owner ACL、章节和首个修订；其他保存使用乐观并发，相同 clientMutationId 重试不会重复建版。",
    params: documentParams, body: UpdateDocumentRequestSchema,
    responses: { 200: { description: "幂等重试命中的既有修订。", schema: DocumentEnvelopeSchema }, 201: { description: "新建的不可变修订。", schema: DocumentEnvelopeSchema }, 403: { description: "当前身份无编辑权限。", schema: ApiErrorSchema }, 409: { description: "当前 revision 与 baseRevision 冲突，details.currentRevision 可用于刷新。", schema: ApiErrorSchema }, 422: { description: "正文包含非法节点、属性或 URL。", schema: ApiErrorSchema } },
  },
  {
    operationId: "updateDocumentChapter", method: "PATCH", path: "/api/documents/:documentId/chapters/:chapterId", tags: ["文档"], implementationStatus: "implemented",
    summary: "更新章节目录行（隐藏/恢复）", description: "需要 author 或 moderator。隐藏的章节读者不可读；作者写完取消隐藏后恢复可读。",
    params: documentChapterParams, body: UpdateDocumentChapterRequestSchema,
    responses: { 200: { description: "更新后的章节目录行。", schema: ChapterSchema }, 403: { description: "当前身份无编辑权限。", schema: ApiErrorSchema }, 404: { description: "文档或章节不存在。", schema: ApiErrorSchema }, 422: { description: "请求字段非法。", schema: ApiErrorSchema } },
  },
  {
    operationId: "deleteDocumentChapter", method: "DELETE", path: "/api/documents/:documentId/chapters/:chapterId", tags: ["文档"], implementationStatus: "implemented",
    summary: "删除章节目录中的章节", description: "需要 author 或 moderator。编辑器「删除章节」移除正文后再调用本接口删除对应目录行（幂等：不存在时返回 deleted = false）；历史修订与章节独立版本号不受影响，关联校订建议解除章节归属但不删除。",
    params: documentChapterParams,
    responses: { 200: { description: "删除结果；deleted = false 表示目录中本就没有该章。", schema: DeleteDocumentChapterResponseSchema }, 403: { description: "当前身份无编辑权限。", schema: ApiErrorSchema }, 404: { description: "文档不存在。", schema: ApiErrorSchema } },
  },
  {
    operationId: "createDocumentChapter", method: "POST", path: "/api/documents/:documentId/chapters", tags: ["文档"], implementationStatus: "implemented",
    summary: "注册正文中出现的新章节", description: "需要 author 或 moderator。编辑器的「新增章节」只修改正文；保存前客户端必须把正文中服务器目录缺失的新章节注册进来。服务端按位置分配章节 id（chapter-<order>，同位置重复注册幂等返回同一行），客户端用返回的 id 同步本地目录并执行文档保存——新章节历史与独立版本号才能按该 id 归集。",
    params: documentParams, body: CreateDocumentChapterRequestSchema,
    responses: { 200: { description: "重复注册命中的已有章节行。", schema: ChapterSchema }, 201: { description: "新建的章节行，客户端应把该 id 同步回本地目录。", schema: ChapterSchema }, 403: { description: "当前身份无编辑权限。", schema: ApiErrorSchema }, 404: { description: "文档不存在。", schema: ApiErrorSchema }, 422: { description: "标题或顺序非法。", schema: ApiErrorSchema } },
  },
  {
    operationId: "updateDocumentSteps", method: "PATCH", path: "/api/documents/:documentId/steps", tags: ["文档"],
    summary: "使用 ProseMirror 增量步骤更新文档", description: "需要 author 或 moderator。客户端提交 transaction steps，服务端基于当前 revision 应用 steps 并创建新修订。首版仅定义契约，后续实现服务端应用。",
    params: documentParams, body: UpdateDocumentStepsRequestSchema,
    responses: { 200: { description: "幂等重试命中的既有修订。", schema: DocumentEnvelopeSchema }, 201: { description: "新建的不可变修订。", schema: DocumentEnvelopeSchema }, 403: { description: "当前身份无编辑权限。", schema: ApiErrorSchema }, 409: { description: "当前 revision 与 baseRevision 冲突。", schema: ApiErrorSchema }, 422: { description: "steps 无法应用到当前文档或包含非法结构。", schema: ApiErrorSchema } },
  },
  {
    operationId: "syncNovelChapters", method: "POST", path: "/api/forum/novels/:novelId/chapters/sync", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "对比章节内容哈希", description: "需要文档 owner、ACL editor 或 moderator。客户端提交本地章节清单（含 SHA-256 哈希），服务端对比已存哈希，返回需要上传的章节与已存在（无需上传）的章节 ID。",
    params: novelParams, body: SyncNovelChaptersRequestSchema,
    responses: { 200: { description: "需要更新与已存在的章节 ID。", schema: SyncNovelChaptersResponseSchema } },
  },
  {
    operationId: "getNovelChapter", method: "GET", path: "/api/forum/novels/:novelId/chapters/:chapterId", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "读取单个已上传章节", description: "按文章与章节 ID 返回分章正文；隐藏章节仅编辑者可读。",
    params: novelChapterParams,
    responses: { 200: { description: "章节目录元数据与正文。", schema: ChapterContentSchema }, 404: { description: "文章、章节不存在或当前身份不可读。", schema: ApiErrorSchema } },
  },
  {
    operationId: "saveNovelChapter", method: "PUT", path: "/api/forum/novels/:novelId/chapters/:chapterId", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "保存单个章节", description: "需要 author 或 moderator。正文经过与文档相同的白名单校验；该章节 baseRevision 过期返回 409。",
    params: novelChapterParams, body: SaveNovelChapterRequestSchema,
    responses: { 201: { description: "保存后的章节版本摘要。", schema: SaveNovelChapterResponseSchema }, 403: { description: "当前身份无编辑权限。", schema: ApiErrorSchema }, 409: { description: "章节已被其他修改更新。", schema: ApiErrorSchema }, 422: { description: "章节内容或字段非法。", schema: ApiErrorSchema } },
  },
  {
    operationId: "saveNovelChaptersBatch", method: "POST", path: "/api/forum/novels/:novelId/chapters/batch", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "批量保存章节正文（每批最多 20 章）", description: "需要 author 或 moderator。整批先读取该批涉及章节的 owner、revision、order 与 content_hash 完成预校验：跨文章 ID、目标 order 被批外章节占用、批内目标 order 重复或任一 baseRevision 过期时整批返回 409（details.chapterId 指出具体章节），正文不发生部分提交。已存在记录 content_hash 与请求 hash 一致时返回 unchanged 与当前 revision，因此上次响应丢失后重试不会再次递增版本。正文继续执行标准 Tiptap 清洗与 longTextBlock 转换保护。路由 body 上限约 5 MiB，超出返回 413。",
    params: novelParams, body: SaveNovelChaptersBatchRequestSchema,
    responses: {
      200: { description: "与请求顺序一致的单章保存结果。", schema: SaveNovelChaptersBatchResponseSchema },
      403: { description: "当前身份无编辑权限。", schema: ApiErrorSchema },
      409: { description: "批内任一章节存在跨文章 ID、order 或 baseRevision 冲突；未发生部分提交。", schema: ApiErrorSchema },
      413: { description: "序列化请求体超过约 5 MiB 上限。", schema: ApiErrorSchema },
      422: { description: "章节数超过 20 或章节字段非法。", schema: ApiErrorSchema },
    },
  },
  {
    operationId: "stageNovelChapterReorder", method: "POST", path: "/api/forum/novels/:novelId/chapters/reorder-stage", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "换序暂存（每批最多 40 项，不发送正文）", description: "需要 author 或 moderator。先把所有移动章节按批放到全局唯一临时 order，再执行最终正文批次，避免中途占用其他章节的目标位置。当前顺序已经等于临时顺序时幂等返回 unchanged，不重复递增 revision；上次响应丢失后的重试同样返回当前 revision。跨文章 ID、目标临时 order 被批外章节占用、批内临时 order 重复或 baseRevision 过期时整批返回 409（details.chapterId 指出具体章节）。",
    params: novelParams, body: StageNovelChapterReorderRequestSchema,
    responses: {
      200: { description: "与请求顺序一致的单章暂存结果。", schema: StageNovelChapterReorderResponseSchema },
      403: { description: "当前身份无编辑权限。", schema: ApiErrorSchema },
      409: { description: "批内任一章节存在跨文章 ID、临时 order 或 baseRevision 冲突；未发生部分提交。", schema: ApiErrorSchema },
      413: { description: "序列化请求体超过约 5 MiB 上限。", schema: ApiErrorSchema },
      422: { description: "章节数超过 40 或字段非法。", schema: ApiErrorSchema },
    },
  },
  {
    operationId: "listRevisions", method: "GET", path: "/api/documents/:documentId/revisions", tags: ["文档"],
    summary: "分页读取版本历史", description: "按 revision 倒序返回；cursor 使用上一页最后一项的 revision。",
    params: documentParams, query: revisionQuery,
    responses: { 200: { description: "不可变版本摘要页。", schema: RevisionPageSchema }, 404: { description: "文档不存在。", schema: ApiErrorSchema } },
  },
  {
    operationId: "getRevision", method: "GET", path: "/api/documents/:documentId/revisions/:revision", tags: ["文档"],
    summary: "读取指定历史版本", description: "读取不可变 revision 的完整 Tiptap JSON，用于只读比较。",
    params: revisionParams,
    responses: { 200: { description: "指定历史 revision 的完整快照。", schema: DocumentEnvelopeSchema }, 404: { description: "文档或版本不存在。", schema: ApiErrorSchema } },
  },
  {
    operationId: "rollbackDocument", method: "POST", path: "/api/documents/:documentId/rollback", tags: ["文档"],
    summary: "回退到指定版本", description: "需要 author 或 moderator。回退会复制目标内容并创建新 revision，不删除任何历史。",
    params: documentParams, body: RollbackDocumentRequestSchema,
    responses: { 200: { description: "幂等重试命中的回滚结果。", schema: DocumentEnvelopeSchema }, 201: { description: "新创建的回滚修订。", schema: DocumentEnvelopeSchema }, 403: { description: "当前身份无回滚权限。", schema: ApiErrorSchema }, 404: { description: "文档或目标修订不存在。", schema: ApiErrorSchema }, 409: { description: "baseRevision 已过期。", schema: ApiErrorSchema } },
  },
  {
    operationId: "uploadAsset", method: "POST", path: "/api/assets", tags: ["图片"],
    summary: "上传本地图片", description: "multipart/form-data 的 file 字段；允许 PNG/JPEG/GIF/WebP，最多 8 MiB。所有已登录论坛身份可上传。",
    responses: { 201: { description: "可直接用于 richImage 节点的资产 URL。", schema: AssetSchema }, 413: { description: "图片超过大小限制。", schema: ApiErrorSchema }, 415: { description: "MIME 或文件签名不是受支持图片。", schema: ApiErrorSchema }, 422: { description: "缺少 file 字段。", schema: ApiErrorSchema } },
  },
  {
    operationId: "readAsset", method: "GET", path: "/api/assets/:assetId", tags: ["图片"],
    summary: "读取资产二进制", description: "按资产 ID 返回图片或附件。Worker 支持 ETag、Range；付费附件仅作者、版主或已购买用户可读。",
    params: assetParams,
    responses: {
      200: { description: "完整二进制；Content-Type 来自保存的白名单 MIME。", schema: z.any() },
      206: { description: "满足 Range 请求的部分二进制。", schema: z.any() },
      304: { description: "ETag 未变化，无响应体。", schema: z.any() },
      401: { description: "受保护附件要求登录。", schema: ApiErrorSchema },
      403: { description: "当前身份未购买该附件。", schema: ApiErrorSchema },
      404: { description: "资产不存在。", schema: ApiErrorSchema },
      416: { description: "Range 超出资产范围。", schema: ApiErrorSchema },
    },
  },
  {
    operationId: "createDiceRoll", method: "POST", path: "/api/dice", tags: ["骰子"],
    summary: "创建稳定骰子结果", description: "表达式由 RPG Dice Roller 解析，例如 3d5。服务端只投掷一次并持久化。",
    body: CreateDiceRollRequestSchema,
    responses: { 201: { description: "新 rollId、明细和总数，例如 3d5=12。", schema: DiceRollSchema }, 422: { description: "骰子表达式不可解析。", schema: ApiErrorSchema } },
  },
  {
    operationId: "getDiceRoll", method: "GET", path: "/api/dice/:rollId", tags: ["骰子"],
    summary: "读取稳定骰子结果", description: "重复读取同一 rollId 绝不会重新投掷。",
    params: diceParams, responses: { 200: { description: "已持久化的原始结果。", schema: DiceRollSchema }, 404: { description: "骰子结果不存在。", schema: ApiErrorSchema } },
  },
  {
    operationId: "rerollDice", method: "POST", path: "/api/dice/:rollId/reroll", tags: ["骰子"],
    summary: "显式重新投掷", description: "创建新 rollId，并通过 previousRollId/rootRollId 保留重投链。",
    params: diceParams, responses: { 201: { description: "新投掷结果。", schema: DiceRollSchema }, 404: { description: "原骰子结果不存在。", schema: ApiErrorSchema } },
  },
  {
    operationId: "getCommentThread", method: "GET", path: "/api/documents/:documentId/comments/:anchorId", tags: ["间贴"],
    summary: "读取间贴回复树", description: "只对根回复做游标分页，返回根节点的完整后代；sort=score 或 newest。",
    params: threadParams, query: commentQuery,
    responses: { 200: { description: "锚点的树状回复及当前身份投票。", schema: CommentThreadSchema }, 404: { description: "文档不存在。", schema: ApiErrorSchema } },
  },
  {
    operationId: "createCommentReply", method: "POST", path: "/api/documents/:documentId/comments/:anchorId/replies", tags: ["间贴"],
    summary: "新增间贴回复", description: "所有论坛身份可回复。parentId 为 null 创建根回复，否则创建楼中楼。",
    params: threadParams, body: CreateCommentReplyRequestSchema,
    responses: { 201: { description: "新回复；children 初始为空。", schema: CommentReplySchema }, 404: { description: "文档或父回复不存在。", schema: ApiErrorSchema }, 409: { description: "锚点已随正文删除并归档。", schema: ApiErrorSchema } },
  },
  {
    operationId: "voteComment", method: "PUT", path: "/api/comments/replies/:replyId/vote", tags: ["间贴"],
    summary: "赞、踩或撤销", description: "value=1 点赞、-1 点踩、0 撤销；每个身份对每条回复只有一票。",
    params: replyParams, body: VoteCommentRequestSchema,
    responses: { 200: { description: "更新后的净赞数、赞踩计数和当前投票。", schema: z.object({ score: z.number().int(), viewerVote: z.union([z.literal(-1), z.literal(0), z.literal(1)]), upvotes: z.number().int().nonnegative(), downvotes: z.number().int().nonnegative(), myVote: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }).strict() }, 404: { description: "回复不存在。", schema: ApiErrorSchema } },
  },
  {
    operationId: "getForumSession", method: "GET", path: "/api/forum/session", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "读取当前论坛身份", description: "生产环境从 HttpOnly session cookie 读取当前身份；本地 demo 模式可使用 x-user-id 切换种子身份。",
    responses: { 200: { description: "当前身份和可切换身份。", schema: ForumSessionSchema } },
  },
  {
    operationId: "listChapters", method: "GET", path: "/api/forum/chapters", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "读取章节目录", description: "仅登录用户返回指定文档按 order 排序的章节目录，非编辑者看不到隐藏章节。",
    query: documentQuery,
    responses: { 200: { description: "按 order 升序的章节。", schema: z.object({ items: z.array(ChapterSchema) }).strict() } },
  },
  {
    operationId: "listSuggestions", method: "GET", path: "/api/forum/documents/:documentId/suggestions", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "读取纠错建议", description: "作者与版主可看到全部状态；读者仅看到自己提交的建议。",
    params: documentParams, responses: { 200: { description: "纠错建议列表。", schema: z.object({ items: z.array(SuggestionSchema) }).strict() }, 404: { description: "文档不存在。", schema: ApiErrorSchema } },
  },
  {
    operationId: "createSuggestion", method: "POST", path: "/api/forum/documents/:documentId/suggestions", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "提交纠错建议", description: "读者提交待审核文字替换；未审核内容不会写入正文。",
    params: documentParams, body: CreateSuggestionRequestSchema, responses: { 201: { description: "pending 状态建议。", schema: SuggestionSchema }, 404: { description: "文档不存在。", schema: ApiErrorSchema } },
  },
  {
    operationId: "reviewSuggestion", method: "PATCH", path: "/api/forum/suggestions/:suggestionId", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "审核纠错建议", description: "仅 author/moderator。approve 会替换当前正文第一次匹配文字并创建 operation=suggestion 的真实修订；reject 只更新建议状态。",
    params: suggestionParams, body: ReviewSuggestionRequestSchema, responses: { 200: { description: "审核后的建议和可选新文档修订。", schema: z.object({ suggestion: SuggestionSchema, document: DocumentEnvelopeSchema.nullable() }).strict() }, 403: { description: "当前身份不可审核。", schema: ApiErrorSchema }, 404: { description: "建议不存在或待替换文字已不存在。", schema: ApiErrorSchema }, 409: { description: "建议已审核或 baseRevision 过期。", schema: ApiErrorSchema } },
  },
  {
    operationId: "listSuggestionBatches", method: "GET", path: "/api/forum/documents/:documentId/suggestion-batches", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "读取整章批量校订", description: "作者与版主可查看全部批次；读者仅看到自己提交的批次。",
    params: documentParams, responses: { 200: { description: "批量校订列表。", schema: z.object({ items: z.array(SuggestionBatchSchema) }).strict() }, 404: { description: "文档不存在。", schema: ApiErrorSchema } },
  },
  {
    operationId: "createSuggestionBatch", method: "POST", path: "/api/forum/documents/:documentId/suggestion-batches", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "提交整章批量校订", description: "把整章编辑产生的多个 ProseMirror steps 合并为一个待审核批次。",
    params: documentParams, body: CreateSuggestionBatchRequestSchema, responses: { 201: { description: "pending 状态批次。", schema: SuggestionBatchSchema }, 409: { description: "提交基线已过期。", schema: ApiErrorSchema }, 422: { description: "steps 与编辑后快照不一致。", schema: ApiErrorSchema } },
  },
  {
    operationId: "reviewSuggestionBatch", method: "PATCH", path: "/api/forum/suggestion-batches/:batchId", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "原子审核整章批量校订", description: "接受时基于最新正文安全重放当前章节的全部修改并只创建一个 revision；其他章节变化不会阻塞，当前章节变化返回冲突；拒绝不修改正文。",
    params: suggestionBatchParams, body: ReviewSuggestionBatchRequestSchema, responses: { 200: { description: "审核后的批次和可选新文档修订。", schema: z.object({ batch: SuggestionBatchSchema, document: DocumentEnvelopeSchema.nullable() }).strict() }, 403: { description: "当前身份不可审核。", schema: ApiErrorSchema }, 409: { description: "批次已审核或基线过期。", schema: ApiErrorSchema }, 422: { description: "steps 无法应用。", schema: ApiErrorSchema } },
  },
  {
    operationId: "searchMentionUsers", method: "GET", path: "/api/forum/users/search", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "搜索 @ 用户", description: "q 同时匹配名称和 ID；friendsOnly=true 仅返回当前身份好友。",
    query: userSearchQuery, responses: { 200: { description: "最多 20 个候选用户。", schema: MentionSearchResultSchema } },
  },
  {
    operationId: "resolveMention", method: "POST", path: "/api/forum/mentions/resolve", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "服务端解析 @", description: "发送时按可选 ID 或精确名称解析非好友；失败时客户端应渲染普通文本。",
    body: ResolveMentionRequestSchema, responses: { 200: { description: "resolved 表示是否使用 @ 成功样式。", schema: ResolveMentionResponseSchema } },
  },
  {
    operationId: "resolveReplyGate", method: "POST", path: "/api/forum/reply-gates/resolve", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "解析回复可见内容", description: "按服务端记录的回复关系返回内容；作者和版主始终可见。",
    body: ResolveReplyGateRequestSchema, responses: { 200: { description: "不可见时 content 为 null。", schema: ResolveReplyGateResponseSchema }, 404: { description: "gateId 不存在。", schema: ApiErrorSchema } },
  },
  {
    operationId: "getAttachment", method: "GET", path: "/api/forum/attachments/:attachmentId", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "读取附件购买状态", description: "未购买时隐藏 downloadUrl；作者和版主直接具备权限。",
    params: attachmentParams, responses: { 200: { description: "附件价格和当前身份权益。", schema: AttachmentSchema }, 404: { description: "附件不存在。", schema: ApiErrorSchema } },
  },
  {
    operationId: "purchaseAttachment", method: "POST", path: "/api/forum/attachments/:attachmentId/purchase", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "购买附件", description: "金币账务；重复购买幂等，首次购买扣款并按售价 70% 向作者入账。",
    params: attachmentParams, responses: { 200: { description: "已购买或重复购买结果。", schema: PurchaseAttachmentResponseSchema }, 402: { description: "金币不足。", schema: ApiErrorSchema }, 404: { description: "附件不存在。", schema: ApiErrorSchema } },
  },
  {
    operationId: "getPoll", method: "GET", path: "/api/forum/polls/:pollId", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "读取投票统计", description: "返回当前身份资格、已选选项和实时计数。",
    params: pollParams, responses: { 200: { description: "投票详情。", schema: PollSchema }, 404: { description: "投票不存在。", schema: ApiErrorSchema } },
  },
  {
    operationId: "submitPollVote", method: "POST", path: "/api/forum/polls/:pollId/votes", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "提交或改投", description: "满足资格的用户可投；单选投票只能提交一个 optionId，重复提交会更新选择。",
    params: pollParams, body: SubmitPollVoteRequestSchema, responses: { 200: { description: "更新后的投票详情。", schema: PollSchema }, 403: { description: "当前身份不满足投票要求。", schema: ApiErrorSchema }, 404: { description: "投票或选项不存在。", schema: ApiErrorSchema }, 422: { description: "选项数量不符合单选/多选要求。", schema: ApiErrorSchema } },
  },
  {
    operationId: "listPollVotes", method: "GET", path: "/api/forum/polls/:pollId/votes", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "分页读取实名投票", description: "按投票时间倒序，cursor 为上一页最后一条记录 ID。",
    params: pollParams, query: CursorQuerySchema, responses: { 200: { description: "实名用户与所选 optionId。", schema: PollVotePageSchema }, 404: { description: "投票不存在。", schema: ApiErrorSchema } },
  },
];

/** 按 operationId 获取路由契约；未找到时抛出开发期错误。 */
export function getContractRoute(operationId: string): ContractRoute {
  const route = contractRoutes.find((candidate) => candidate.operationId === operationId);
  if (!route) throw new Error(`未知契约 operationId: ${operationId}`);
  return route;
}

/**
 * zod 的 default 字段是可选输入，但 zod v4 的 toJSONSchema 仍会把它列入
 * required，导致 Ajv 在缺省时误报 422（真正填充 default 的是路由内的
 * zod parse）。这里把带 default 的属性从 required 中移除，保持契约语义。
 */
function dropDefaultsFromRequired(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  if (schema.type !== "object" || !schema.properties) return schema;
  const properties = schema.properties as Record<
    string,
    { default?: unknown }
  >;
  if (!Array.isArray(schema.required)) return schema;
  return {
    ...schema,
    required: schema.required.filter(
      (key) => properties[key]?.default === undefined,
    ),
  };
}

/** 将 Zod 契约转换为 Fastify 可消费的 JSON Schema。 */
export function getFastifySchema(operationId: string): Record<string, unknown> {
  const route = getContractRoute(operationId);
  const toSchema = (value: z.ZodType) =>
    dropDefaultsFromRequired(
      z.toJSONSchema(value, { target: "draft-7", unrepresentable: "any" }),
    );
  const response = Object.fromEntries(
    Object.entries(route.responses).map(([status, item]) => [
      status,
      toSchema(item.schema),
    ]),
  );
  return {
    operationId: route.operationId,
    summary: route.summary,
    description: route.description,
    tags: route.tags,
    ...(route.params ? { params: toSchema(route.params) } : {}),
    ...(route.query ? { querystring: toSchema(route.query) } : {}),
    ...(route.body ? { body: toSchema(route.body) } : {}),
    response,
    ...(route.implementationStatus ? { "x-implementation-status": route.implementationStatus } : {}),
  };
}
