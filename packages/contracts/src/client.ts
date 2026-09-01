import type { z } from "zod";
import type {
  Asset,
  ChapterSchema,
  DeleteDocumentChapterResponseSchema,
  CommentReply,
  CommentThread,
  ForumUser,
  DiceRollResult,
  DocumentEnvelope,
  RevisionPage,
  AttachmentSchema,
  PollSchema,
  PollVotePageSchema,
  PurchaseAttachmentResponseSchema,
  ResolveMentionResponseSchema,
  ResolveReplyGateResponseSchema,
  SuggestionBatchSchema,
  SuggestionSchema,
} from "./schemas.js";

/** 非 2xx 响应抛出的类型化错误。 */
export class ApiClientError extends Error {
  /** HTTP 状态码。 */
  readonly status: number;
  /** 服务端稳定错误代码。 */
  readonly code: string;
  /** 可用于冲突处理等 UI 的结构化详情。 */
  readonly details: Record<string, unknown> | undefined;

  /** 创建 API 客户端错误。 */
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** 创建客户端时可注入的 fetch 与论坛身份选项。 */
export interface ApiClientOptions {
  /** API 根地址；浏览器同源代理时保持空字符串。 */
  baseUrl?: string;
  /** 开发环境写入 `x-user-id` 的身份 ID；传函数时每个请求动态解析。 */
  userId?: string | (() => string | undefined);
  /** 可注入 mock fetch 或宿主自定义网络实现。 */
  fetch?: typeof fetch;
}

/** 由共享契约约束的浏览器 API 客户端。 */
export interface RiceTextApiClient {
  /** 读取文档当前 revision 和 Tiptap JSON。 */
  getDocument(documentId: string, signal?: AbortSignal): Promise<DocumentEnvelope>;
  /** 按 baseRevision 乐观并发更新正文。 */
  updateDocument(documentId: string, body: { schemaVersion: number; baseRevision: number; clientMutationId: string; content: DocumentEnvelope["content"] }, signal?: AbortSignal): Promise<DocumentEnvelope>;
  /** 使用 ProseMirror 增量 steps 更新文档（服务端完整应用）。 */
  updateDocumentSteps(documentId: string, body: { schemaVersion: number; baseRevision: number; clientMutationId: string; steps: Array<Record<string, unknown>>; chapterId?: string }, signal?: AbortSignal): Promise<DocumentEnvelope>;
  /** 注册正文中出现、但目录缺失的新章节；返回服务器分配的章节 id，客户端应同步回本地目录。 */
  createDocumentChapter(documentId: string, body: { title: string; order: number }, signal?: AbortSignal): Promise<z.infer<typeof ChapterSchema>>;
  /** 删除章节目录行（幂等）；历史修订不受影响。 */
  deleteDocumentChapter(documentId: string, chapterId: string, signal?: AbortSignal): Promise<z.infer<typeof DeleteDocumentChapterResponseSchema>>;
  /** 对比章节内容哈希，返回需要上传与已存在的章节 ID。 */
  syncNovelChapters(novelId: string, chapters: Array<{ id: string; title: string; order: number; hash: string }>, signal?: AbortSignal): Promise<{ toUpdate: string[]; existing: string[] }>;
  /** 保存单个章节内容并递增该章节版本号。 */
  saveNovelChapter(novelId: string, chapterId: string, input: { title: string; order: number; content: DocumentEnvelope["content"]; hash: string; baseRevision: number }, signal?: AbortSignal): Promise<{ id: string; title: string; order: number; revision: number }>;
  /** 游标分页读取不可变版本历史。 */
  listRevisions(documentId: string, cursor?: string, chapterId?: string, signal?: AbortSignal): Promise<RevisionPage>;
  /** 读取指定不可变 revision 的完整文档快照。 */
  getRevision(documentId: string, revision: number, signal?: AbortSignal): Promise<DocumentEnvelope>;
  /** 复制指定历史快照并创建新的回滚 revision。 */
  rollbackDocument(documentId: string, body: { baseRevision: number; targetRevision: number; clientMutationId: string }, signal?: AbortSignal): Promise<DocumentEnvelope>;
  /** 使用 multipart 上传图片二进制。 */
  uploadAsset(file: File, signal?: AbortSignal): Promise<Asset>;
  /** 创建并持久化一次新骰子结果；传 rerollOf 时服务端创建关联旧结果的重投。 */
  createDice(expression: string, rerollOf?: string | null, signal?: AbortSignal): Promise<DiceRollResult>;
  /** 按 rollId 读取稳定结果，不触发重投。 */
  getDice(rollId: string, signal?: AbortSignal): Promise<DiceRollResult>;
  /** 显式重投并创建关联旧结果的新 rollId。 */
  rerollDice(rollId: string, signal?: AbortSignal): Promise<DiceRollResult>;
  /** 按锚点读取排序后的间贴树。 */
  getCommentThread(documentId: string, anchorId: string, sort?: "score" | "newest", cursor?: string, signal?: AbortSignal): Promise<CommentThread>;
  /** 创建根回复或指定 parentId 的楼中楼。 */
  createCommentReply(documentId: string, anchorId: string, body: string, parentId?: string, signal?: AbortSignal): Promise<CommentReply>;
  /** 设置赞、踩或 0 撤销，并返回权威计数。 */
  voteComment(replyId: string, value: -1 | 0 | 1, signal?: AbortSignal): Promise<{ score: number; viewerVote: -1 | 0 | 1; upvotes: number; downvotes: number; myVote: -1 | 0 | 1 }>;
  /** 读取当前和可切换的论坛身份。 */
  getForumSession(signal?: AbortSignal): Promise<{ current: ForumUser; available: ForumUser[] }>;
  /** 读取章节目录（按 order 排序，含每章独立版本号）。 */
  listChapters(signal?: AbortSignal): Promise<{ items: Array<z.infer<typeof ChapterSchema>> }>;
  /** 按名称或 ID 搜索好友/用户。 */
  searchUsers(query: string, friendsOnly?: boolean, signal?: AbortSignal): Promise<{ items: ForumUser[] }>;
  /** 在发布前由服务端解析非好友 mention。 */
  resolveMention(name: string, userId?: string, signal?: AbortSignal): Promise<z.infer<typeof ResolveMentionResponseSchema>>;
  /** 按当前身份投影回复可见内容。 */
  resolveReplyGate(gateId: string, documentId: string, signal?: AbortSignal): Promise<z.infer<typeof ResolveReplyGateResponseSchema>>;
  /** 读取当前身份可见的章节纠错建议。 */
  listSuggestions(documentId: string, signal?: AbortSignal): Promise<{ items: Array<z.infer<typeof SuggestionSchema>> }>;
  /** 提交一条带章节和行定位的待审核纠错建议。 */
  createSuggestion(documentId: string, body: { fromText: string; toText: string; reason: string; chapterId: string; chapterTitle: string; lineNo: number; lineText: string }, signal?: AbortSignal): Promise<z.infer<typeof SuggestionSchema>>;
  /** 审核纠错建议；approve 时服务端替换正文并创建真实修订。 */
  reviewSuggestion(suggestionId: string, body: { decision: "approve" | "reject"; baseRevision: number }, signal?: AbortSignal): Promise<{ suggestion: z.infer<typeof SuggestionSchema>; document: DocumentEnvelope | null }>; 
  /** 读取整章多处修改合并成的校订批次。 */
  listSuggestionBatches(documentId: string, signal?: AbortSignal): Promise<{ items: Array<z.infer<typeof SuggestionBatchSchema>> }>;
  /** 提交一个整章校订批次。 */
  createSuggestionBatch(documentId: string, body: { baseRevision: number; chapterId: string; chapterTitle: string; beforeContent: DocumentEnvelope["content"]; afterContent: DocumentEnvelope["content"]; steps: Array<Record<string, unknown>>; reason: string }, signal?: AbortSignal): Promise<z.infer<typeof SuggestionBatchSchema>>;
  /** 原子审核整章校订批次。 */
  reviewSuggestionBatch(batchId: string, body: { decision: "approve" | "reject"; baseRevision: number }, signal?: AbortSignal): Promise<{ batch: z.infer<typeof SuggestionBatchSchema>; document: DocumentEnvelope | null }>;
  /** 读取附件价格和当前购买权益。 */
  getAttachment(id: string, signal?: AbortSignal): Promise<z.infer<typeof AttachmentSchema>>;
  /** 幂等购买附件并执行金币分账。 */
  purchaseAttachment(id: string, signal?: AbortSignal): Promise<z.infer<typeof PurchaseAttachmentResponseSchema>>;
  /** 读取投票资格、选项和汇总计数。 */
  getPoll(id: string, signal?: AbortSignal): Promise<z.infer<typeof PollSchema>>;
  /** 提交或覆盖当前身份的投票选择。 */
  submitPollVote(id: string, optionIds: string[], signal?: AbortSignal): Promise<z.infer<typeof PollSchema>>;
  /** 游标分页读取实名投票明细。 */
  listPollVotes(id: string, cursor?: string, signal?: AbortSignal): Promise<z.infer<typeof PollVotePageSchema>>;
}

/** 创建零依赖的类型化 fetch 客户端。 */
export function createApiClient(options: ApiClientOptions = {}): RiceTextApiClient {
  const baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
  const fetcher = options.fetch ?? fetch;
  type ClientRequestInit = Omit<RequestInit, "signal"> & { signal?: AbortSignal | undefined };
  // 所有方法共享错误解包路径，保证调用方只处理 ApiClientError 而非各类 Response。
  const request = async <T>(path: string, init: ClientRequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers);
    const userId = typeof options.userId === "function" ? options.userId() : options.userId;
    if (userId) headers.set("x-user-id", userId);
    if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
    const { signal, ...requestInit } = init;
    const response = await fetcher(`${baseUrl}${path}`, { ...requestInit, headers, ...(signal ? { signal } : {}) });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null;
      throw new ApiClientError(response.status, payload?.error?.code ?? "HTTP_ERROR", payload?.error?.message ?? response.statusText, payload?.error?.details);
    }
    return await response.json() as T;
  };
  const json = (value: unknown): string => JSON.stringify(value);
  // 只编码已提供参数，避免把 undefined 传成字符串并破坏游标语义。
  const query = (entries: Record<string, string | number | boolean | undefined>): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(entries)) if (value !== undefined) params.set(key, String(value));
    const encoded = params.toString();
    return encoded ? `?${encoded}` : "";
  };
  return {
    getDocument: (id, signal) => request(`/api/documents/${id}`, { signal }),
    updateDocument: (id, body, signal) => request(`/api/documents/${id}`, { method: "PUT", body: json(body), signal }),
    updateDocumentSteps: (id, body, signal) => request(`/api/documents/${id}/steps`, { method: "PATCH", body: json(body), signal }),
    createDocumentChapter: (id, body, signal) => request(`/api/documents/${id}/chapters`, { method: "POST", body: json(body), signal }),
    deleteDocumentChapter: (id, chapterId, signal) => request(`/api/documents/${id}/chapters/${chapterId}`, { method: "DELETE", signal }),
    syncNovelChapters: (novelId, chapters, signal) => request(`/api/forum/novels/${novelId}/chapters/sync`, { method: "POST", body: json({ chapters }), signal }),
    saveNovelChapter: (novelId, chapterId, input, signal) => request(`/api/forum/novels/${novelId}/chapters/${chapterId}`, { method: "PUT", body: json(input), signal }),
    listRevisions: (id, cursor, chapterId, signal) => request(`/api/documents/${id}/revisions${query({ cursor, chapterId })}`, { signal }),
    getRevision: (id, revision, signal) => request(`/api/documents/${id}/revisions/${revision}`, { signal }),
    rollbackDocument: (id, body, signal) => request(`/api/documents/${id}/rollback`, { method: "POST", body: json(body), signal }),
    uploadAsset: (file, signal) => { const form = new FormData(); form.set("file", file); return request("/api/assets", { method: "POST", body: form, signal }); },
    createDice: (expression, rerollOf, signal) => request("/api/dice", { method: "POST", body: json({ expression, ...(rerollOf ? { rerollOf } : {}) }), signal }),
    getDice: (id, signal) => request(`/api/dice/${id}`, { signal }),
    rerollDice: (id, signal) => request(`/api/dice/${id}/reroll`, { method: "POST", signal }),
    getCommentThread: (documentId, anchorId, sort = "score", cursor, signal) => request(`/api/documents/${documentId}/comments/${anchorId}${query({ sort, cursor })}`, { signal }),
    createCommentReply: (documentId, anchorId, body, parentId, signal) => request(`/api/documents/${documentId}/comments/${anchorId}/replies`, { method: "POST", body: json({ body, parentId: parentId ?? null }), signal }),
    voteComment: (replyId, value, signal) => request(`/api/comments/replies/${replyId}/vote`, { method: "PUT", body: json({ value }), signal }),
    getForumSession: (signal) => request("/api/forum/session", { signal }),
    listChapters: (signal) => request("/api/forum/chapters", { signal }),
    searchUsers: (q, friendsOnly = false, signal) => request(`/api/forum/users/search${query({ q, friendsOnly })}`, { signal }),
    resolveMention: (name, userId, signal) => request("/api/forum/mentions/resolve", { method: "POST", body: json({ name, ...(userId ? { userId } : {}) }), signal }),
    resolveReplyGate: (gateId, documentId, signal) => request("/api/forum/reply-gates/resolve", { method: "POST", body: json({ gateId, documentId }), signal }),
    listSuggestions: (id, signal) => request(`/api/forum/documents/${id}/suggestions`, { signal }),
    createSuggestion: (id, body, signal) => request(`/api/forum/documents/${id}/suggestions`, { method: "POST", body: json(body), signal }),
    reviewSuggestion: (id, body, signal) => request(`/api/forum/suggestions/${id}`, { method: "PATCH", body: json(body), signal }),
    listSuggestionBatches: (id, signal) => request(`/api/forum/documents/${id}/suggestion-batches`, { signal }),
    createSuggestionBatch: (id, body, signal) => request(`/api/forum/documents/${id}/suggestion-batches`, { method: "POST", body: json(body), signal }),
    reviewSuggestionBatch: (id, body, signal) => request(`/api/forum/suggestion-batches/${id}`, { method: "PATCH", body: json(body), signal }),
    getAttachment: (id, signal) => request(`/api/forum/attachments/${id}`, { signal }),
    purchaseAttachment: (id, signal) => request(`/api/forum/attachments/${id}/purchase`, { method: "POST", signal }),
    getPoll: (id, signal) => request(`/api/forum/polls/${id}`, { signal }),
    submitPollVote: (id, optionIds, signal) => request(`/api/forum/polls/${id}/votes`, { method: "POST", body: json({ optionIds }), signal }),
    listPollVotes: (id, cursor, signal) => request(`/api/forum/polls/${id}/votes${query({ cursor })}`, { signal }),
  };
}
