import { z } from "zod";
import {
  ApiErrorSchema,
  AssetSchema,
  AttachmentSchema,
  ChapterSchema,
  CommentReplySchema,
  CommentSortSchema,
  CommentThreadSchema,
  CreateCommentReplyRequestSchema,
  CreateDiceRollRequestSchema,
  CreateSuggestionRequestSchema,
  CursorQuerySchema,
  ForumUserSchema,
  DiceRollSchema,
  DocumentEnvelopeSchema,
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
  ReviewSuggestionRequestSchema,
  RollbackDocumentRequestSchema,
  SaveNovelChapterRequestSchema,
  SaveNovelChapterResponseSchema,
  SubmitPollVoteRequestSchema,
  SuggestionSchema,
  SyncNovelChaptersRequestSchema,
  SyncNovelChaptersResponseSchema,
  UpdateDocumentRequestSchema,
  UpdateDocumentStepsRequestSchema,
  VoteCommentRequestSchema,
} from "./schemas.js";

/** 契约使用的 HTTP 方法。 */
export type ContractMethod = "GET" | "POST" | "PUT" | "PATCH";

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
const revisionQuery = CursorQuerySchema;
const assetParams = z.object({ assetId: EntityIdSchema.describe("上传后返回的图片资产 ID") }).strict();
const diceParams = z.object({ rollId: EntityIdSchema.describe("首次投掷或重投生成的稳定 rollId") }).strict();
const threadParams = z.object({ documentId: EntityIdSchema, anchorId: EntityIdSchema }).strict();
const commentQuery = CursorQuerySchema.extend({ sort: CommentSortSchema.default("score") }).strict();
const replyParams = z.object({ replyId: EntityIdSchema }).strict();
const suggestionParams = z.object({ suggestionId: EntityIdSchema }).strict();
const userSearchQuery = z.object({ q: z.string().max(80).default(""), friendsOnly: z.coerce.boolean().default(false) }).strict();
const attachmentParams = z.object({ attachmentId: EntityIdSchema }).strict();
const pollParams = z.object({ pollId: EntityIdSchema }).strict();
const novelParams = z.object({ novelId: EntityIdSchema.describe("章节所属的文档/小说 ID") }).strict();
const novelChapterParams = z.object({ novelId: EntityIdSchema, chapterId: EntityIdSchema }).strict();

/** 全部REST 契约；OpenAPI 和 Fastify schema 均由此生成。 */
export const contractRoutes: readonly ContractRoute[] = [
  {
    operationId: "getDocument", method: "GET", path: "/api/documents/:documentId", tags: ["文档"],
    summary: "读取当前文档", description: "读取最新不可变修订的 Tiptap JSON。任何论坛身份均可访问。",
    params: documentParams,
    responses: { 200: { description: "当前文档，例如 revision 为 1 的 demo-post。", schema: DocumentEnvelopeSchema }, 404: { description: "文档不存在。", schema: ApiErrorSchema } },
  },
  {
    operationId: "updateDocument", method: "PUT", path: "/api/documents/:documentId", tags: ["文档"],
    summary: "保存文档并创建修订", description: "需要 author 或 moderator。baseRevision 过期返回 409；相同 clientMutationId 重试返回首次结果且不重复建版。",
    params: documentParams, body: UpdateDocumentRequestSchema,
    responses: { 200: { description: "幂等重试命中的既有修订。", schema: DocumentEnvelopeSchema }, 201: { description: "新建的不可变修订。", schema: DocumentEnvelopeSchema }, 403: { description: "当前身份无编辑权限。", schema: ApiErrorSchema }, 409: { description: "当前 revision 与 baseRevision 冲突，details.currentRevision 可用于刷新。", schema: ApiErrorSchema }, 422: { description: "正文包含非法节点、属性或 URL。", schema: ApiErrorSchema } },
  },
  {
    operationId: "updateDocumentSteps", method: "PATCH", path: "/api/documents/:documentId/steps", tags: ["文档"],
    summary: "使用 ProseMirror 增量步骤更新文档", description: "需要 author 或 moderator。客户端提交 transaction steps，服务端基于当前 revision 应用 steps 并创建新修订。首版仅定义契约，后续实现服务端应用。",
    params: documentParams, body: UpdateDocumentStepsRequestSchema,
    responses: { 200: { description: "幂等重试命中的既有修订。", schema: DocumentEnvelopeSchema }, 201: { description: "新建的不可变修订。", schema: DocumentEnvelopeSchema }, 403: { description: "当前身份无编辑权限。", schema: ApiErrorSchema }, 409: { description: "当前 revision 与 baseRevision 冲突。", schema: ApiErrorSchema }, 422: { description: "steps 无法应用到当前文档或包含非法结构。", schema: ApiErrorSchema } },
  },
  {
    operationId: "syncNovelChapters", method: "POST", path: "/api/forum/novels/:novelId/chapters/sync", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "对比章节内容哈希", description: "客户端提交本地章节清单（含 SHA-256 哈希），服务端对比已存哈希，返回需要上传的章节与已存在（无需上传）的章节 ID。",
    params: novelParams, body: SyncNovelChaptersRequestSchema,
    responses: { 200: { description: "需要更新与已存在的章节 ID。", schema: SyncNovelChaptersResponseSchema } },
  },
  {
    operationId: "saveNovelChapter", method: "PUT", path: "/api/forum/novels/:novelId/chapters/:chapterId", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "保存单个章节", description: "需要 author 或 moderator。正文经过与文档相同的白名单校验；该章节 baseRevision 过期返回 409。",
    params: novelChapterParams, body: SaveNovelChapterRequestSchema,
    responses: { 201: { description: "保存后的章节版本摘要。", schema: SaveNovelChapterResponseSchema }, 403: { description: "当前身份无编辑权限。", schema: ApiErrorSchema }, 409: { description: "章节已被其他修改更新。", schema: ApiErrorSchema }, 422: { description: "章节内容或字段非法。", schema: ApiErrorSchema } },
  },
  {
    operationId: "listRevisions", method: "GET", path: "/api/documents/:documentId/revisions", tags: ["文档"],
    summary: "分页读取版本历史", description: "按 revision 倒序返回；cursor 使用上一页最后一项的 revision。",
    params: documentParams, query: revisionQuery,
    responses: { 200: { description: "不可变版本摘要页。", schema: RevisionPageSchema }, 404: { description: "文档不存在。", schema: ApiErrorSchema } },
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
    summary: "读取图片二进制", description: "按资产 ID 返回原始图片，并设置 immutable 缓存头；不代理外链。",
    params: assetParams,
    responses: { 200: { description: "图片二进制；实际 Content-Type 来自保存的白名单 MIME。", schema: z.any() }, 404: { description: "资产不存在。", schema: ApiErrorSchema } },
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
    summary: "读取当前论坛身份", description: "由 x-user-id 请求头选择 author、reader 或 moderator；默认 reader。",
    responses: { 200: { description: "当前身份和可切换身份。", schema: z.object({ current: ForumUserSchema, available: z.array(ForumUserSchema) }).strict() } },
  },
  {
    operationId: "listChapters", method: "GET", path: "/api/forum/chapters", tags: ["论坛业务"], implementationStatus: "implemented",
    summary: "读取章节目录", description: "返回当前文档按 order 排序的持久化章节目录。",
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
