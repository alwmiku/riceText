import {
  CommentReplySchema,
  CommentThreadSchema,
  type CommentReply,
  type CommentThread,
  type ForumUser,
} from "@ricetext/contracts";
import { WorkerHttpError } from "../http-error";

type ThreadRow = { archived: number };
type ReplyRow = {
  id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  author_id: string;
  author_name: string;
  author_role: "author" | "reader" | "moderator";
  author_coins: number;
  score: number;
  upvotes: number;
  downvotes: number;
  viewer_vote: -1 | 0 | 1;
};

function replyFromRow(row: ReplyRow): CommentReply {
  return CommentReplySchema.parse({
    id: row.id,
    parentId: row.parent_id,
    author: {
      id: row.author_id,
      name: row.author_name,
      role: row.author_role,
      avatar: Array.from(row.author_name)[0] ?? "用",
      coins: Number(row.author_coins),
      replied: true,
    },
    body: row.body,
    score: Number(row.score),
    viewerVote: Number(row.viewer_vote),
    upvotes: Number(row.upvotes),
    downvotes: Number(row.downvotes),
    myVote: Number(row.viewer_vote),
    createdAt: row.created_at,
    children: [],
  });
}

/** 间贴仓储；回复写入依赖数据库触发器同步生成 reply receipt，供回复可见门禁使用。 */
export class D1CommentRepository {
  constructor(private readonly db: D1Database) {}

  async thread(
    documentId: string,
    anchorId: string,
    viewerId: string,
    sort: "score" | "newest",
    cursor: string | undefined,
    limit: number,
  ): Promise<CommentThread> {
    const document = await this.db
      .prepare("SELECT 1 AS found FROM documents WHERE id = ?")
      .bind(documentId)
      .first<{ found: number }>();
    if (!document) throw new WorkerHttpError(404, "DOCUMENT_NOT_FOUND", "文档不存在");
    const thread = await this.db
      .prepare(
        "SELECT archived FROM comment_threads WHERE document_id = ? AND anchor_id = ?",
      )
      .bind(documentId, anchorId)
      .first<ThreadRow>();
    if (!thread) {
      return CommentThreadSchema.parse({
        documentId,
        anchorId,
        archived: false,
        total: 0,
        items: [],
        pageInfo: { nextCursor: null },
      });
    }
    const rows = await this.db
      .prepare(
        "SELECT reply.id, reply.parent_id, reply.body, reply.created_at, " +
          "user.id AS author_id, user.name AS author_name, user.role AS author_role, " +
          "COALESCE(wallet.balance, 0) AS author_coins, " +
          "COALESCE(SUM(vote.value), 0) AS score, " +
          "COALESCE(SUM(CASE WHEN vote.value = 1 THEN 1 ELSE 0 END), 0) AS upvotes, " +
          "COALESCE(SUM(CASE WHEN vote.value = -1 THEN 1 ELSE 0 END), 0) AS downvotes, " +
          "COALESCE(MAX(CASE WHEN vote.user_id = ? THEN vote.value END), 0) AS viewer_vote " +
          "FROM comment_replies reply JOIN users user ON user.id = reply.author_id " +
          "LEFT JOIN wallets wallet ON wallet.user_id = user.id " +
          "LEFT JOIN comment_votes vote ON vote.reply_id = reply.id " +
          "WHERE reply.document_id = ? AND reply.anchor_id = ? " +
          "GROUP BY reply.id, reply.parent_id, reply.body, reply.created_at, " +
          "user.id, user.name, user.role, wallet.balance",
      )
      .bind(viewerId, documentId, anchorId)
      .all<ReplyRow>();
    const map = new Map(rows.results.map((row) => [row.id, replyFromRow(row)]));
    const roots: CommentReply[] = [];
    for (const item of map.values()) {
      const parent = item.parentId ? map.get(item.parentId) : undefined;
      if (parent) parent.children.push(item);
      else roots.push(item);
    }
    const compare =
      sort === "score"
        ? (a: CommentReply, b: CommentReply) =>
            b.score - a.score || b.createdAt.localeCompare(a.createdAt)
        : (a: CommentReply, b: CommentReply) => b.createdAt.localeCompare(a.createdAt);
    const sortTree = (items: CommentReply[]): void => {
      items.sort(compare);
      for (const item of items) sortTree(item.children);
    };
    sortTree(roots);
    let start = 0;
    if (cursor) {
      const index = roots.findIndex((root) => root.id === cursor);
      if (index === -1) {
        throw new WorkerHttpError(
          422,
          "INVALID_CURSOR",
          "间贴 cursor 不在当前锚点根回复中",
        );
      }
      start = index + 1;
    }
    const page = roots.slice(start, start + limit);
    const hasMore = start + limit < roots.length;
    return CommentThreadSchema.parse({
      documentId,
      anchorId,
      archived: thread.archived === 1,
      total: rows.results.length,
      items: page,
      pageInfo: { nextCursor: hasMore ? page.at(-1)!.id : null },
    });
  }

  async createReply(
    documentId: string,
    anchorId: string,
    parentId: string | null,
    body: string,
    principal: ForumUser,
  ): Promise<CommentReply> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const inserted = await this.db
      .prepare(
        "INSERT INTO comment_replies(" +
          "id, document_id, anchor_id, parent_id, author_id, body, created_at" +
          ") SELECT ?, ?, ?, ?, ?, ?, ? FROM comment_threads thread " +
          "WHERE thread.document_id = ? AND thread.anchor_id = ? AND thread.archived = 0 " +
          "AND (? IS NULL OR EXISTS (" +
          "SELECT 1 FROM comment_replies parent WHERE parent.id = ? " +
          "AND parent.document_id = ? AND parent.anchor_id = ?)) " +
          "RETURNING id",
      )
      .bind(
        id,
        documentId,
        anchorId,
        parentId,
        principal.id,
        body,
        createdAt,
        documentId,
        anchorId,
        parentId,
        parentId,
        documentId,
        anchorId,
      )
      .first<{ id: string }>();
    if (!inserted) {
      const thread = await this.db
        .prepare(
          "SELECT archived FROM comment_threads WHERE document_id = ? AND anchor_id = ?",
        )
        .bind(documentId, anchorId)
        .first<ThreadRow>();
      if (!thread) {
        throw new WorkerHttpError(
          404,
          "COMMENT_ANCHOR_NOT_FOUND",
          "正文中不存在该间贴锚点",
        );
      }
      if (thread.archived === 1) {
        throw new WorkerHttpError(
          409,
          "COMMENT_THREAD_ARCHIVED",
          "锚点已删除，间贴线程只读归档",
        );
      }
      throw new WorkerHttpError(404, "PARENT_REPLY_NOT_FOUND", "父回复不属于该间贴线程");
    }
    const wallet = await this.db
      .prepare("SELECT balance FROM wallets WHERE user_id = ?")
      .bind(principal.id)
      .first<{ balance: number }>();
    return CommentReplySchema.parse({
      id,
      parentId,
      author: {
        id: principal.id,
        name: principal.name,
        role: principal.role,
        avatar: Array.from(principal.name)[0] ?? "用",
        coins: wallet?.balance ?? 0,
        replied: true,
      },
      body,
      score: 0,
      viewerVote: 0,
      upvotes: 0,
      downvotes: 0,
      myVote: 0,
      createdAt,
      children: [],
    });
  }

  async vote(
    replyId: string,
    userId: string,
    value: -1 | 0 | 1,
  ): Promise<{
    score: number;
    viewerVote: -1 | 0 | 1;
    upvotes: number;
    downvotes: number;
    myVote: -1 | 0 | 1;
  }> {
    const reply = await this.db
      .prepare("SELECT 1 AS found FROM comment_replies WHERE id = ?")
      .bind(replyId)
      .first<{ found: number }>();
    if (!reply) {
      throw new WorkerHttpError(404, "COMMENT_REPLY_NOT_FOUND", "间贴回复不存在");
    }
    if (value === 0) {
      await this.db
        .prepare("DELETE FROM comment_votes WHERE reply_id = ? AND user_id = ?")
        .bind(replyId, userId)
        .run();
    } else {
      await this.db
        .prepare(
          "INSERT INTO comment_votes(reply_id, user_id, value, created_at) " +
            "VALUES (?, ?, ?, ?) ON CONFLICT(reply_id, user_id) DO UPDATE SET " +
            "value = excluded.value, created_at = excluded.created_at",
        )
        .bind(replyId, userId, value, new Date().toISOString())
        .run();
    }
    const row = await this.db
      .prepare(
        "SELECT COALESCE(SUM(value), 0) AS score, " +
          "COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0) AS upvotes, " +
          "COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0) AS downvotes, " +
          "COALESCE(MAX(CASE WHEN user_id = ? THEN value END), 0) AS viewer_vote " +
          "FROM comment_votes WHERE reply_id = ?",
      )
      .bind(userId, replyId)
      .first<{ score: number; upvotes: number; downvotes: number; viewer_vote: -1 | 0 | 1 }>();
    const viewerVote = Number(row?.viewer_vote ?? 0) as -1 | 0 | 1;
    return {
      score: Number(row?.score ?? 0),
      viewerVote,
      upvotes: Number(row?.upvotes ?? 0),
      downvotes: Number(row?.downvotes ?? 0),
      myVote: viewerVote,
    };
  }
}
