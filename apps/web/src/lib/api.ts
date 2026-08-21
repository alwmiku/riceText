import type { NovelChapter, NovelChapterList } from "@ricetext/contracts";
import { createId } from "./utils";
import { defaultDocument, seedComments, seedRevisions } from "./seed";
import type {
  CommentReply,
  DiceResult,
  DocumentEnvelope,
  RevisionSummary,
  RichTextNode,
  UploadedAsset,
} from "./types";

/**
 * Web 宿主使用的轻量 API 适配层。
 *
 * 真实 HTTP 错误必须向上抛出，让页面显示权限、校验或 revision 冲突；只有网络完全
 * 不可达时才使用 localStorage/种子数据维持独立编辑器演示。
 */
const API_ROOT = import.meta.env.VITE_API_ROOT ?? "/api";

/** 将前端展示身份映射为服务端 AuthProvider 接受的演示身份。 */
function getDemoUserHeader(): "author" | "reader" | "moderator" {
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

/** 统一注入演示身份、解析 JSON，并把非 2xx 响应转换为 {@link ApiError}。 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  headers.set("x-demo-user", getDemoUserHeader());
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers,
  });
  const body = (await response.json().catch(() => null)) as
    T | { message?: string } | null;
  if (!response.ok) {
    throw new ApiError(
      (body as { message?: string } | null)?.message ??
        `请求失败 (${response.status})`,
      response.status,
      body,
    );
  }
  return body as T;
}

/** 读取服务端文档；断网时按“本地副本 -> 内置种子”顺序降级。 */
export async function getDocument(
  id: string,
  signal?: AbortSignal,
): Promise<DocumentEnvelope> {
  try {
    return {
      ...(await request<DocumentEnvelope>(
        `/documents/${id}`,
        signal ? { signal } : undefined,
      )),
      storage: "server",
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    const cached = localStorage.getItem(`ricetext:document:${id}`);
    return cached ? (JSON.parse(cached) as DocumentEnvelope) : defaultDocument;
  }
}

/**
 * 使用 baseRevision 保存完整 Tiptap JSON。
 *
 * HTTP 4xx/5xx 表示服务端明确拒绝，不能伪装成保存成功；仅 fetch 级网络错误才写入
 * localStorage，并以 `local-demo` 标记提醒用户这不是服务端 revision。
 */
export async function saveDocument(
  id: string,
  input: {
    schemaVersion: number;
    baseRevision: number;
    clientMutationId: string;
    content: RichTextNode;
  },
): Promise<DocumentEnvelope> {
  try {
    return await request<DocumentEnvelope>(`/documents/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const current = await getDocument(id);
    const saved: DocumentEnvelope = {
      ...current,
      content: input.content,
      revision: Math.max(current.revision, input.baseRevision) + 1,
      savedAt: new Date().toISOString(),
      storage: "local-demo",
    };
    localStorage.setItem(`ricetext:document:${id}`, JSON.stringify(saved));
    return saved;
  }
}

/** 读取不可变版本摘要；断网时返回可操作的演示历史。 */
export async function getRevisions(
  id: string,
  signal?: AbortSignal,
): Promise<RevisionSummary[]> {
  try {
    const result = await request<{ items: RevisionSummary[] }>(
      `/documents/${id}/revisions?limit=20`,
      signal ? { signal } : undefined,
    );
    return result.items;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return seedRevisions;
  }
}

/** 回滚到指定 revision；服务端会创建新版本而不是删除历史。 */
export async function restoreRevision(
  id: string,
  revision: number,
  baseRevision: number,
): Promise<DocumentEnvelope> {
  return request<DocumentEnvelope>(`/documents/${id}/rollback`, {
    method: "POST",
    body: JSON.stringify({
      targetRevision: revision,
      baseRevision,
      clientMutationId: createId("restore"),
    }),
  });
}

/** 读取小说章节列表。 */
export async function listNovelChapters(novelId: string): Promise<NovelChapterList> {
  return request<NovelChapterList>(`/novels/${novelId}/chapters`);
}

/** 保存整个小说章节（后续可切换为章节级增量）。 */
export async function updateNovelChapter(
  novelId: string,
  chapterId: string,
  input: { baseRevision: number; clientMutationId: string; content: RichTextNode },
): Promise<NovelChapter> {
  return request<NovelChapter>(`/novels/${novelId}/chapters/${chapterId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/**
 * 请求服务端创建或重投骰子。
 * 断网 fallback 仅用于演示，结果插入正文后仍会随 JSON 持久化，重新渲染不会再次投掷。
 */
export async function createDice(
  expression: string,
  rerollOf: string | null = null,
): Promise<DiceResult> {
  try {
    return await request<DiceResult>("/dice", {
      method: "POST",
      body: JSON.stringify({ expression, rerollOf }),
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
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
  const data = new FormData();
  data.append("file", file);
  try {
    const response = await fetch(`${API_ROOT}/assets`, {
      method: "POST",
      headers: { "x-demo-user": getDemoUserHeader() },
      body: data,
    });
    if (!response.ok) throw new ApiError("图片上传失败", response.status);
    return (await response.json()) as UploadedAsset;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (file.size > 8 * 1024 * 1024)
      throw new ApiError("演示上传限制为 8 MB", 422);
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
    const result = await request<{ items: CommentReply[] }>(
      `/documents/${documentId}/comments/${anchorId}?sort=score`,
    );
    return result.items;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return structuredClone(seedComments);
  }
}

/** 设置当前用户的赞、踩或撤销状态；返回服务端重新计算后的计数。 */
export async function voteComment(
  commentId: string,
  vote: -1 | 0 | 1,
): Promise<{ upvotes: number; downvotes: number; myVote: -1 | 0 | 1 }> {
  try {
    return await request(`/comments/replies/${commentId}/vote`, {
      method: "PUT",
      body: JSON.stringify({ value: vote }),
    });
  } catch {
    return {
      upvotes: 8 + (vote === 1 ? 1 : 0),
      downvotes: vote === -1 ? 1 : 0,
      myVote: vote,
    };
  }
}
