import {
  ApiClientError,
  createApiClient,
  type DocumentEnvelope as ContractDocumentEnvelope,
} from "@ricetext/contracts";
import {
  applyStepsToDocument,
  sharedSchema,
  type JSONContent,
  type StepJson,
} from "@ricetext/document-core";
import { createId } from "./utils";
import {
  defaultDocument,
  seedComments,
  seedRevisions,
  seedSuggestions,
} from "./seed";
import type {
  CommentReply,
  DiceResult,
  DocumentEnvelope,
  ForumAttachment,
  ForumChapterItem,
  ForumPoll,
  ForumSuggestion,
  RevisionSummary,
  RichTextNode,
  UploadedAsset,
} from "./types";

/**
 * Web 宿主使用的轻量 API 适配层。
 *
 * 网络请求统一走 @ricetext/contracts 的类型化客户端（单一来源），本层只负责
 * 两件事：注入当前论坛身份、在服务不可达时降级到 localStorage/种子数据。
 * HTTP 业务错误必须向上抛出，让页面显示权限、校验或 revision 冲突。
 */
// 契约客户端的请求路径已包含 /api 前缀；VITE_API_ROOT 仅在 API 部署在
// 其他主机时提供主机根（例如 https://api.example.com）。
const API_ROOT = import.meta.env.VITE_API_ROOT ?? "";

/** 将前端展示身份映射为服务端 AuthProvider 接受的论坛身份。 */
function getForumUserHeader(): "author" | "reader" | "moderator" {
  const identity = localStorage.getItem("ricetext:identity");
  if (identity === "user_reader" || identity === "reader") return "reader";
  if (identity === "user_moderator" || identity === "moderator")
    return "moderator";
  return "author";
}

/** 保留 HTTP 状态码和原始错误体，供自动保存区分 409 与普通失败。 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** 每个请求动态解析身份，创建一次客户端即可覆盖身份切换。 */
const api = () => createApiClient({ baseUrl: API_ROOT, userId: getForumUserHeader });

/**
 * 后端服务不可达（断网，或仅启动 Web 时 Vite 代理返回的 502/503）
 * 时允许读接口降级到本地副本/种子数据；权限、校验、冲突等业务
 * 错误必须继续向上抛出，让页面正确展示。
 */
function isServiceUnavailable(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return false;
  }
  if (error instanceof ApiClientError) {
    return error.status === 502 || error.status === 503;
  }
  return true;
}

/** 把共享客户端的类型化错误转换为 Web 宿主使用的 ApiError。 */
function rethrowClientError(error: unknown): never {
  if (error instanceof ApiClientError) {
    throw new ApiError(error.message, error.status, error.details);
  }
  throw error;
}

/** 读取服务端文档；断网或服务不可用时按“本地副本 -> 内置种子”顺序降级。 */
export async function getDocument(
  id: string,
  signal?: AbortSignal,
): Promise<DocumentEnvelope> {
  try {
    const envelope = await api().getDocument(id, signal);
    return {
      ...envelope,
      content: envelope.content as unknown as RichTextNode,
      storage: "server",
    };
  } catch (error) {
    if (!isServiceUnavailable(error)) rethrowClientError(error);
    const cached = localStorage.getItem(`ricetext:document:${id}`);
    return cached ? (JSON.parse(cached) as DocumentEnvelope) : defaultDocument;
  }
}

/** 读取论坛章节目录（含每章独立版本号）；服务不可用时返回空目录。 */
export async function listForumChapters(): Promise<ForumChapterItem[]> {
  try {
    return (await api().listChapters()).items;
  } catch (error) {
    if (!isServiceUnavailable(error)) rethrowClientError(error);
    return [];
  }
}

/** 服务器端章节内容哈希清单中的一项。 */
export interface ChapterSyncItem {
  id: string;
  title: string;
  order: number;
  /** 章节正文的内容哈希（SHA-256）。 */
  hash: string;
}

/** 对比本地章节清单与服务器，返回需要上传的章节 id。 */
export async function syncLongTextChapters(
  novelId: string,
  chapters: readonly ChapterSyncItem[],
): Promise<{ toUpdate: string[]; existing: string[] }> {
  return api().syncNovelChapters(novelId, [...chapters]);
}

/** 上传单个章节（含内容与哈希）；baseRevision 冲突时抛出 409。 */
export async function uploadLongTextChapter(
  novelId: string,
  chapterId: string,
  input: {
    title: string;
    order: number;
    content: RichTextNode;
    hash: string;
    baseRevision: number;
  },
): Promise<{ id: string; title: string; order: number; revision: number }> {
  return api().saveNovelChapter(novelId, chapterId, {
    ...input,
    content: input.content as unknown as ContractDocumentEnvelope["content"],
  });
}

/**
 * 使用 baseRevision 保存完整 Tiptap JSON。
 *
 * HTTP 4xx/5xx 表示服务端明确拒绝，不能伪装成保存成功；仅 fetch 级网络错误才写入
 * localStorage，并以 `local-cache` 标记提醒用户这不是服务端 revision。
 */
export async function saveDocument(
  id: string,
  input: {
    schemaVersion: number;
    baseRevision: number;
    clientMutationId: string;
    content: RichTextNode;
    /** 本次编辑的章节 id；服务端保存成功后递增该章节版本号。 */
    chapterId?: string;
  },
): Promise<DocumentEnvelope> {
  try {
    const envelope = await api().updateDocument(id, {
      ...input,
      content: input.content as unknown as ContractDocumentEnvelope["content"],
    });
    return {
      ...envelope,
      content: envelope.content as unknown as RichTextNode,
      storage: "server",
    };
  } catch (error) {
    if (error instanceof ApiClientError) rethrowClientError(error);
    const current = await getDocument(id);
    const saved: DocumentEnvelope = {
      ...current,
      content: input.content,
      revision: Math.max(current.revision, input.baseRevision) + 1,
      savedAt: new Date().toISOString(),
      storage: "local-cache",
    };
    localStorage.setItem(`ricetext:document:${id}`, JSON.stringify(saved));
    return saved;
  }
}

/**
 * 上传最小 transaction steps，服务端完整运行 ProseMirror 应用并创建新修订。
 * 网络不可达时在本地应用 steps 并缓存整篇（恢复在线后基线 diff 自然覆盖）。
 */
export async function saveDocumentSteps(
  id: string,
  input: {
    schemaVersion: number;
    baseRevision: number;
    clientMutationId: string;
    steps: StepJson[];
    /** 本次编辑的章节 id；steps 应用成功后该章节版本号递增。 */
    chapterId?: string;
  },
): Promise<DocumentEnvelope> {
  try {
    const envelope = await api().updateDocumentSteps(id, {
      ...input,
      steps: input.steps as unknown as Array<Record<string, unknown>>,
    });
    return {
      ...envelope,
      content: envelope.content as unknown as RichTextNode,
      storage: "server",
    };
  } catch (error) {
    if (error instanceof ApiClientError) rethrowClientError(error);
    const current = await getDocument(id);
    let content: RichTextNode = current.content;
    try {
      content = applyStepsToDocument(
        sharedSchema(),
        current.content as unknown as JSONContent,
        input.steps,
      ) as RichTextNode;
    } catch {
      // 本地应用失败时保留服务器版本，避免写入无法解析的本地缓存。
    }
    const saved: DocumentEnvelope = {
      ...current,
      content,
      revision: Math.max(current.revision, input.baseRevision) + 1,
      savedAt: new Date().toISOString(),
      storage: "local-cache",
    };
    localStorage.setItem(`ricetext:document:${id}`, JSON.stringify(saved));
    return saved;
  }
}

/** 读取不可变版本摘要；断网或服务不可用时返回可操作的本地历史。 */
export async function getRevisions(
  id: string,
  signal?: AbortSignal,
): Promise<RevisionSummary[]> {
  try {
    return (await api().listRevisions(id, undefined, signal)).items;
  } catch (error) {
    if (!isServiceUnavailable(error)) rethrowClientError(error);
    return seedRevisions;
  }
}

/** 回滚到指定 revision；服务端会创建新版本而不是删除历史。 */
export async function restoreRevision(
  id: string,
  revision: number,
  baseRevision: number,
): Promise<DocumentEnvelope> {
  const envelope = await api().rollbackDocument(id, {
    targetRevision: revision,
    baseRevision,
    clientMutationId: createId("restore"),
  });
  return { ...envelope, content: envelope.content as unknown as RichTextNode };
}

/**
 * 请求服务端创建或重投骰子。
 * 断网 fallback 仅用于离线回退，结果插入正文后仍会随 JSON 持久化，重新渲染不会再次投掷。
 */
export async function createDice(
  expression: string,
  rerollOf: string | null = null,
): Promise<DiceResult> {
  try {
    return await api().createDice(expression, rerollOf ?? undefined);
  } catch (error) {
    if (error instanceof ApiClientError) rethrowClientError(error);
    const match = /^(\d{1,2})d(\d{1,4})(?:([+-])([0-9]{1,4}))?$/i.exec(
      expression.replace(/\s/g, ""),
    );
    if (!match) throw new ApiError("请输入例如 3d5、1d20+2 的骰子表达式", 422);
    const count = Number(match[1]);
    const sides = Number(match[2]);
    if (count < 1 || count > 50 || sides < 2 || sides > 1000)
      throw new ApiError("骰子数量或面数超出范围", 422);
    const rolls = Array.from(
      { length: count },
      () => Math.floor(Math.random() * sides) + 1,
    );
    const modifier = match[3] ? Number(`${match[3]}${match[4]}`) : 0;
    return {
      rollId: createId("roll"),
      expression,
      rolls,
      total: rolls.reduce((sum, value) => sum + value, modifier),
      rerollOf,
    };
  }
}

/** 上传图片二进制；不设置 JSON Content-Type，让浏览器生成 multipart boundary。 */
export async function uploadAsset(file: File): Promise<UploadedAsset> {
  try {
    const asset = await api().uploadAsset(file);
    return {
      assetId: asset.assetId,
      url: asset.url,
      name: asset.name,
      mimeType: asset.mimeType,
      size: asset.size,
    };
  } catch (error) {
    if (error instanceof ApiClientError) rethrowClientError(error);
    if (file.size > 8 * 1024 * 1024)
      throw new ApiError("上传限制为 8 MB", 422);
    return {
      assetId: createId("asset"),
      url: URL.createObjectURL(file),
      name: file.name,
      mimeType: file.type,
      size: file.size,
    };
  }
}

/** 按文档和段落锚点读取间贴树；网络不可达时使用深拷贝种子避免污染全局 fixture。 */
export async function getCommentThread(
  documentId: string,
  anchorId: string,
): Promise<CommentReply[]> {
  try {
    return (await api().getCommentThread(documentId, anchorId, "score")).items;
  } catch (error) {
    if (!isServiceUnavailable(error)) rethrowClientError(error);
    return structuredClone(seedComments);
  }
}

/** 设置当前用户的赞、踩或撤销状态；返回服务端重新计算后的计数。 */
export async function voteComment(
  commentId: string,
  vote: -1 | 0 | 1,
): Promise<{ upvotes: number; downvotes: number; myVote: -1 | 0 | 1 }> {
  try {
    const result = await api().voteComment(commentId, vote);
    return {
      upvotes: result.upvotes,
      downvotes: result.downvotes,
      myVote: result.myVote,
    };
  } catch {
    return {
      upvotes: 8 + (vote === 1 ? 1 : 0),
      downvotes: vote === -1 ? 1 : 0,
      myVote: vote,
    };
  }
}

/** 读取文档的纠错建议（读者仅见自己的）；断网或服务不可用时返回本地演示数据。 */
export async function listSuggestions(
  documentId: string,
  signal?: AbortSignal,
): Promise<ForumSuggestion[]> {
  try {
    return (await api().listSuggestions(documentId, signal)).items;
  } catch (error) {
    if (!isServiceUnavailable(error)) rethrowClientError(error);
    return structuredClone(seedSuggestions);
  }
}

/** 提交带章节内行定位的纠错建议。 */
export async function submitSuggestion(
  documentId: string,
  input: {
    fromText: string;
    toText: string;
    reason: string;
    chapterId: string;
    chapterTitle: string;
    lineNo: number;
    lineText: string;
  },
): Promise<ForumSuggestion> {
  return api().createSuggestion(documentId, input);
}

/** 审核建议；approve 会替换正文并创建新修订。 */
export async function reviewSuggestion(
  suggestionId: string,
  decision: "approve" | "reject",
  baseRevision: number,
): Promise<{ suggestion: ForumSuggestion; document: DocumentEnvelope | null }> {
  const result = await api().reviewSuggestion(suggestionId, { decision, baseRevision });
  return {
    suggestion: result.suggestion,
    document: result.document
      ? { ...result.document, content: result.document.content as unknown as RichTextNode }
      : null,
  };
}

/** 读取附件及当前身份的购买状态。 */
export async function getAttachment(
  attachmentId: string,
  signal?: AbortSignal,
): Promise<ForumAttachment> {
  return api().getAttachment(attachmentId, signal);
}

/** 购买附件（幂等），返回附件与余额变化。 */
export async function purchaseAttachment(
  attachmentId: string,
): Promise<{
  attachment: ForumAttachment;
  buyerBalance: number;
  authorIncome: number;
  alreadyPurchased: boolean;
}> {
  return api().purchaseAttachment(attachmentId);
}

/** 读取投票。 */
export async function getPoll(
  pollId: string,
  signal?: AbortSignal,
): Promise<ForumPoll> {
  return api().getPoll(pollId, signal);
}

/** 提交或覆盖投票选择，返回更新后的投票。 */
export async function votePoll(
  pollId: string,
  optionIds: string[],
): Promise<ForumPoll> {
  return api().submitPollVote(pollId, optionIds);
}

/** 分页读取实名投票明细。 */
export async function getPollVotes(
  pollId: string,
  cursor?: string,
): Promise<{
  items: Array<{
    user: { id: string; name: string; role: string };
    optionIds: string[];
    createdAt: string;
  }>;
  pageInfo: { nextCursor: string | null };
}> {
  return api().listPollVotes(pollId, cursor);
}

export type { ForumSuggestion } from "./types";
