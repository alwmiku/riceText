import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CommentReply, CommentThread } from "@ricetext/contracts";
import type { RequestIdentity } from "./auth.js";
import { HttpError } from "./errors.js";

interface ThreadRow { archived: number; }
interface ReplyRow {
  id: string; parent_id: string | null; body: string; created_at: string;
  author_id: string; author_name: string; author_role: "author" | "reader" | "moderator";
  author_coins: number; score: number; upvotes: number; downvotes: number; viewer_vote: -1 | 0 | 1;
}

/** 间贴树、回复和每用户赞踩服务。 */
export class CommentService {
  readonly #db: DatabaseSync;
  /** 绑定 API 数据库。 */
  constructor(db: DatabaseSync) { this.#db = db; }

  /** 读取根节点分页、后代完整的树。 */
  getThread(documentId: string, anchorId: string, viewerId: string, sort: "score" | "newest", cursor: string | undefined, limit: number): CommentThread {
    const document = this.#db.prepare("SELECT 1 FROM documents WHERE id = ?").get(documentId);
    if (!document) throw new HttpError(404, "DOCUMENT_NOT_FOUND", "文档不存在");
    const thread = this.#db.prepare("SELECT archived FROM comment_threads WHERE document_id = ? AND anchor_id = ?").get(documentId, anchorId) as unknown as ThreadRow | undefined;
    if (!thread) return { documentId, anchorId, archived: false, total: 0, items: [], pageInfo: { nextCursor: null } };
    const rows = this.#db.prepare(`
      SELECT r.id, r.parent_id, r.body, r.created_at, u.id AS author_id, u.name AS author_name, u.role AS author_role, COALESCE(w.balance, 0) AS author_coins,
             COALESCE(SUM(v.value), 0) AS score,
             COALESCE(SUM(CASE WHEN v.value = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
             COALESCE(SUM(CASE WHEN v.value = -1 THEN 1 ELSE 0 END), 0) AS downvotes,
             COALESCE(MAX(CASE WHEN v.user_id = ? THEN v.value END), 0) AS viewer_vote
      FROM comment_replies r JOIN users u ON u.id = r.author_id
      LEFT JOIN wallets w ON w.user_id = u.id
      LEFT JOIN comment_votes v ON v.reply_id = r.id
      WHERE r.document_id = ? AND r.anchor_id = ?
      GROUP BY r.id, r.parent_id, r.body, r.created_at, u.id, u.name, u.role, w.balance
    `).all(viewerId, documentId, anchorId) as unknown as ReplyRow[];
    const map = new Map<string, CommentReply>();
    for (const row of rows) map.set(row.id, { id: row.id, parentId: row.parent_id, author: { id: row.author_id, name: row.author_name, role: row.author_role, avatar: Array.from(row.author_name)[0] ?? "用", coins: Number(row.author_coins), replied: true }, body: row.body, score: Number(row.score), viewerVote: Number(row.viewer_vote) as -1 | 0 | 1, upvotes: Number(row.upvotes), downvotes: Number(row.downvotes), myVote: Number(row.viewer_vote) as -1 | 0 | 1, createdAt: row.created_at, children: [] });
    const roots: CommentReply[] = [];
    for (const reply of map.values()) {
      const parent = reply.parentId ? map.get(reply.parentId) : undefined;
      if (parent) parent.children.push(reply); else roots.push(reply);
    }
    const compare = sort === "score"
      ? (a: CommentReply, b: CommentReply) => b.score - a.score || b.createdAt.localeCompare(a.createdAt)
      : (a: CommentReply, b: CommentReply) => b.createdAt.localeCompare(a.createdAt);
    const sortTree = (items: CommentReply[]): void => { items.sort(compare); for (const item of items) sortTree(item.children); };
    sortTree(roots);
    let start = 0;
    if (cursor) {
      const index = roots.findIndex((root) => root.id === cursor);
      if (index === -1) throw new HttpError(422, "INVALID_CURSOR", "间贴 cursor 不在当前锚点根回复中");
      start = index + 1;
    }
    const page = roots.slice(start, start + limit);
    const hasMore = start + limit < roots.length;
    return { documentId, anchorId, archived: thread.archived === 1, total: rows.length, items: page, pageInfo: { nextCursor: hasMore ? page.at(-1)!.id : null } };
  }

  /** 新建根回复或楼中楼回复。 */
  reply(documentId: string, anchorId: string, parentId: string | null, body: string, identity: RequestIdentity): CommentReply {
    const thread = this.#db.prepare("SELECT archived FROM comment_threads WHERE document_id = ? AND anchor_id = ?").get(documentId, anchorId) as unknown as ThreadRow | undefined;
    if (!thread) throw new HttpError(404, "COMMENT_ANCHOR_NOT_FOUND", "正文中不存在该间贴锚点");
    if (thread.archived === 1) throw new HttpError(409, "COMMENT_THREAD_ARCHIVED", "锚点已删除，间贴线程只读归档");
    if (parentId) {
      const parent = this.#db.prepare("SELECT document_id, anchor_id FROM comment_replies WHERE id = ?").get(parentId) as { document_id: string; anchor_id: string } | undefined;
      if (!parent || parent.document_id !== documentId || parent.anchor_id !== anchorId) throw new HttpError(404, "PARENT_REPLY_NOT_FOUND", "父回复不属于该间贴线程");
    }
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.#db.prepare("INSERT INTO comment_replies(id, document_id, anchor_id, parent_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, documentId, anchorId, parentId, identity.id, body, createdAt);
    this.#db.prepare("INSERT OR IGNORE INTO reply_receipts(document_id, user_id, created_at) VALUES (?, ?, ?)").run(documentId, identity.id, createdAt);
    const wallet = this.#db.prepare("SELECT balance FROM wallets WHERE user_id = ?").get(identity.id) as { balance: number } | undefined;
    return { id, parentId, author: { id: identity.id, name: identity.name, role: identity.role, avatar: Array.from(identity.name)[0] ?? "用", coins: wallet?.balance ?? 0, replied: true }, body, score: 0, viewerVote: 0, upvotes: 0, downvotes: 0, myVote: 0, createdAt, children: [] };
  }

  /** 设置赞踩；0 删除当前用户投票。 */
  vote(replyId: string, userId: string, value: -1 | 0 | 1): { score: number; viewerVote: -1 | 0 | 1; upvotes: number; downvotes: number; myVote: -1 | 0 | 1 } {
    if (!this.#db.prepare("SELECT 1 FROM comment_replies WHERE id = ?").get(replyId)) throw new HttpError(404, "COMMENT_REPLY_NOT_FOUND", "间贴回复不存在");
    if (value === 0) this.#db.prepare("DELETE FROM comment_votes WHERE reply_id = ? AND user_id = ?").run(replyId, userId);
    else this.#db.prepare("INSERT INTO comment_votes(reply_id, user_id, value, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(reply_id, user_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at").run(replyId, userId, value, new Date().toISOString());
    const row = this.#db.prepare("SELECT COALESCE(SUM(value), 0) AS score, COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0) AS upvotes, COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0) AS downvotes FROM comment_votes WHERE reply_id = ?").get(replyId) as { score: number; upvotes: number; downvotes: number };
    return { score: Number(row.score), viewerVote: value, upvotes: Number(row.upvotes), downvotes: Number(row.downvotes), myVote: value };
  }
}
