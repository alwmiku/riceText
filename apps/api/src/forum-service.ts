import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  ForumUser,
  DocumentEnvelope,
  TiptapDocument,
} from "@ricetext/contracts";
import {
  applyStepsToDocument,
  diffDocuments,
  sharedSchema,
  type JSONContent,
} from "@ricetext/document-core";
import type { RequestIdentity } from "./auth.js";
import { replaceFirstText, type DocumentService } from "./document-service.js";
import { HttpError } from "./errors.js";

interface UserRow {
  id: string;
  name: string;
  role: "author" | "reader" | "moderator";
  is_friend: number;
  bio: string;
}
interface SuggestionRow {
  id: string;
  document_id: string;
  chapter_id: string | null;
  chapter_title: string;
  line_no: number;
  line_text: string;
  from_text: string;
  to_text: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  author_id: string;
  reviewer_id: string | null;
  created_at: string;
}
interface SuggestionBatchRow {
  id: string;
  document_id: string;
  chapter_id: string;
  chapter_title: string;
  base_revision: number;
  before_content_json: string;
  after_content_json: string;
  steps_json: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  author_id: string;
  reviewer_id: string | null;
  created_at: string;
}
interface AttachmentRow {
  id: string;
  name: string;
  mime_type: string;
  price: number;
  author_id: string;
  download_url: string;
}
interface PollRow {
  id: string;
  question: string;
  multiple: number;
  minimum_role: string;
}

function mapUser(row: UserRow): ForumUser {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    isFriend: row.is_friend === 1,
    bio: row.bio,
  };
}
function mapSuggestion(row: SuggestionRow) {
  return {
    id: row.id,
    documentId: row.document_id,
    chapterId: row.chapter_id ?? "",
    chapterTitle: row.chapter_title,
    lineNo: row.line_no,
    lineText: row.line_text,
    fromText: row.from_text,
    toText: row.to_text,
    reason: row.reason,
    status: row.status,
    authorId: row.author_id,
    reviewerId: row.reviewer_id,
    createdAt: row.created_at,
  };
}

function mapSuggestionBatch(row: SuggestionBatchRow) {
  return {
    id: row.id,
    documentId: row.document_id,
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    baseRevision: row.base_revision,
    beforeContent: JSON.parse(row.before_content_json) as TiptapDocument,
    afterContent: JSON.parse(row.after_content_json) as TiptapDocument,
    steps: JSON.parse(row.steps_json) as Array<Record<string, unknown>>,
    reason: row.reason,
    status: row.status,
    authorId: row.author_id,
    reviewerId: row.reviewer_id,
    createdAt: row.created_at,
  };
}

function chapterRange(content: TiptapDocument, chapterIndex: number) {
  const starts: number[] = [];
  content.content.forEach((node, index) => {
    if (node.type === "heading" && node.attrs?.level === 2) starts.push(index);
  });
  if (starts.length === 0 && chapterIndex === 0)
    return { start: 0, end: content.content.length };
  const start = starts[chapterIndex];
  if (start === undefined) return null;
  return { start, end: starts[chapterIndex + 1] ?? content.content.length };
}

function expectedBatchDocument(
  current: TiptapDocument,
  chapterId: string,
  before: TiptapDocument,
  after: TiptapDocument,
): TiptapDocument | null {
  const match = /^chapter-(\d+)$/.exec(chapterId);
  if (!match) return null;
  const range = chapterRange(current, Number(match[1]));
  if (!range) return null;
  const existing = {
    type: "doc" as const,
    content: current.content.slice(range.start, range.end),
  };
  if (JSON.stringify(existing) !== JSON.stringify(before)) return null;
  const content = [...current.content];
  content.splice(range.start, range.end - range.start, ...after.content);
  return { type: "doc", content };
}

/** 首版章节、@、回复可见、附件和投票的 SQLite 论坛适配器。 */
export class ForumService {
  readonly #db: DatabaseSync;
  readonly #documents: DocumentService;
  /** 绑定数据库与真实文档服务。 */
  constructor(db: DatabaseSync, documents: DocumentService) {
    this.#db = db;
    this.#documents = documents;
  }

  /** 可用于开发身份切换器的用户列表。 */
  users(): ForumUser[] {
    const rows = this.#db
      .prepare(
        "SELECT id, name, role, is_friend, bio FROM users ORDER BY CASE role WHEN 'author' THEN 1 WHEN 'reader' THEN 2 ELSE 3 END, id",
      )
      .all() as unknown as UserRow[];
    return rows.map(mapUser);
  }

  /** 搜索名称或 ID，可限制为好友。 */
  searchUsers(query: string, friendsOnly: boolean): ForumUser[] {
    const normalized = `%${query.toLocaleLowerCase()}%`;
    const rows = this.#db
      .prepare(
        "SELECT id, name, role, is_friend, bio FROM users WHERE (lower(id) LIKE ? OR lower(name) LIKE ?) AND (? = 0 OR is_friend = 1) ORDER BY is_friend DESC, name LIMIT 20",
      )
      .all(normalized, normalized, friendsOnly ? 1 : 0) as unknown as UserRow[];
    return rows.map(mapUser);
  }

  /** 按 ID 优先、名称其次解析 @。 */
  resolveMention(
    name: string,
    userId: string | undefined,
  ): { resolved: boolean; displayText: string; user: ForumUser | null } {
    const row = (userId
      ? this.#db
          .prepare(
            "SELECT id, name, role, is_friend, bio FROM users WHERE id = ?",
          )
          .get(userId)
      : this.#db
          .prepare(
            "SELECT id, name, role, is_friend, bio FROM users WHERE lower(name) = lower(?)",
          )
          .get(name)) as unknown as UserRow | undefined;
    return {
      resolved: Boolean(row),
      displayText: `@${row?.name ?? name}`,
      user: row ? mapUser(row) : null,
    };
  }

  /** 章节目录。 */
  chapters(): Array<{
    id: string;
    title: string;
    order: number;
    documentId: string;
    revision: number;
  }> {
    const rows = this.#db
      .prepare(
        "SELECT id, title, sort_order, document_id, revision FROM chapters ORDER BY sort_order",
      )
      .all() as Array<{
      id: string;
      title: string;
      sort_order: number;
      document_id: string;
      revision: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      order: row.sort_order,
      documentId: row.document_id,
      revision: row.revision,
    }));
  }

  /** 服务器已有章节的内容哈希（id -> hash），用于差异对比。 */
  chapterHashes(documentId: string): Map<string, string | null> {
    const rows = this.#db
      .prepare("SELECT id, content_hash FROM chapters WHERE document_id = ?")
      .all(documentId) as Array<{ id: string; content_hash: string | null }>;
    return new Map(rows.map((row) => [row.id, row.content_hash]));
  }

  /**
   * 保存章节内容（幂等写入由调用方负责）。返回更新后的章节与版本号。
   * content_hash 用于后续差异对比；相同哈希视为内容未变化。
   */
  saveChapter(
    documentId: string,
    chapterId: string,
    input: {
      title: string;
      order: number;
      content: TiptapDocument;
      hash: string;
      baseRevision: number;
    },
  ): { id: string; title: string; order: number; revision: number } {
    const existing = this.#db
      .prepare("SELECT revision FROM chapters WHERE id = ? AND document_id = ?")
      .get(chapterId, documentId) as { revision: number } | undefined;
    if (existing && existing.revision !== input.baseRevision)
      throw new HttpError(
        409,
        "CHAPTER_REVISION_CONFLICT",
        "章节已被其他修改更新，请重新对比差异",
        {
          currentRevision: existing.revision,
          baseRevision: input.baseRevision,
        },
      );
    const revision = (existing?.revision ?? 0) + 1;
    this.#db
      .prepare(
        `INSERT INTO chapters(id, title, sort_order, document_id, revision, content_json, content_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           sort_order = excluded.sort_order,
           revision = excluded.revision,
           content_json = excluded.content_json,
           content_hash = excluded.content_hash`,
      )
      .run(
        chapterId,
        input.title,
        input.order,
        documentId,
        revision,
        JSON.stringify(input.content),
        input.hash,
      );
    return { id: chapterId, title: input.title, order: input.order, revision };
  }

  /** 按身份过滤纠错建议。 */
  suggestions(documentId: string, identity: RequestIdentity) {
    this.#documents.get(documentId);
    const rows = (identity.role === "reader"
      ? this.#db
          .prepare(
            "SELECT * FROM suggestions WHERE document_id = ? AND author_id = ? ORDER BY created_at DESC",
          )
          .all(documentId, identity.id)
      : this.#db
          .prepare(
            "SELECT * FROM suggestions WHERE document_id = ? ORDER BY created_at DESC",
          )
          .all(documentId)) as unknown as SuggestionRow[];
    return rows.map(mapSuggestion);
  }

  /** 按身份读取整章批量校订。 */
  suggestionBatches(documentId: string, identity: RequestIdentity) {
    this.#documents.get(documentId);
    const rows = (identity.role === "reader"
      ? this.#db
          .prepare(
            "SELECT * FROM suggestion_batches WHERE document_id = ? AND author_id = ? ORDER BY created_at DESC",
          )
          .all(documentId, identity.id)
      : this.#db
          .prepare(
            "SELECT * FROM suggestion_batches WHERE document_id = ? ORDER BY created_at DESC",
          )
          .all(documentId)) as unknown as SuggestionBatchRow[];
    return rows.map(mapSuggestionBatch);
  }

  /** 创建一个包含多个 steps 的待审核整章校订批次。 */
  createSuggestionBatch(
    documentId: string,
    input: {
      baseRevision: number;
      chapterId: string;
      chapterTitle: string;
      beforeContent: TiptapDocument;
      afterContent: TiptapDocument;
      steps: Array<Record<string, unknown>>;
      reason: string;
    },
    identity: RequestIdentity,
  ) {
    const current = this.#documents.get(documentId);
    if (current.revision !== input.baseRevision)
      throw new HttpError(409, "REVISION_CONFLICT", "正文已变化，请重新编辑后提交", {
        currentRevision: current.revision,
        baseRevision: input.baseRevision,
      });
    const applied = this.#documents.validateSuggestionSteps(
      documentId,
      input.baseRevision,
      input.steps,
    );
    const expected = expectedBatchDocument(
      current.content,
      input.chapterId,
      input.beforeContent,
      input.afterContent,
    );
    const normalizedExpected = expected
      ? applyStepsToDocument(
          sharedSchema(),
          expected as unknown as JSONContent,
          [],
        )
      : null;
    if (
      !normalizedExpected ||
      JSON.stringify(applied) !== JSON.stringify(normalizedExpected)
    )
      throw new HttpError(
        422,
        "BATCH_SCOPE_MISMATCH",
        "批量校订 steps 与当前章节修改不一致",
      );
    const row: SuggestionBatchRow = {
      id: randomUUID(),
      document_id: documentId,
      chapter_id: input.chapterId,
      chapter_title: input.chapterTitle,
      base_revision: input.baseRevision,
      before_content_json: JSON.stringify(input.beforeContent),
      after_content_json: JSON.stringify(input.afterContent),
      steps_json: JSON.stringify(input.steps),
      reason: input.reason,
      status: "pending",
      author_id: identity.id,
      reviewer_id: null,
      created_at: new Date().toISOString(),
    };
    this.#db
      .prepare(
        "INSERT INTO suggestion_batches(id, document_id, chapter_id, chapter_title, base_revision, before_content_json, after_content_json, steps_json, reason, status, author_id, reviewer_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?)",
      )
      .run(
        row.id,
        row.document_id,
        row.chapter_id,
        row.chapter_title,
        row.base_revision,
        row.before_content_json,
        row.after_content_json,
        row.steps_json,
        row.reason,
        row.author_id,
        row.created_at,
      );
    return mapSuggestionBatch(row);
  }

  /** 原子应用或拒绝整章批量校订。 */
  reviewSuggestionBatch(
    batchId: string,
    decision: "approve" | "reject",
    baseRevision: number,
    identity: RequestIdentity,
  ): { batch: ReturnType<typeof mapSuggestionBatch>; document: DocumentEnvelope | null } {
    if (identity.role === "reader")
      throw new HttpError(403, "FORBIDDEN", "只有作者或版主可以审核批量校订");
    const row = this.#db
      .prepare("SELECT * FROM suggestion_batches WHERE id = ?")
      .get(batchId) as unknown as SuggestionBatchRow | undefined;
    if (!row)
      throw new HttpError(404, "SUGGESTION_BATCH_NOT_FOUND", "批量校订不存在");
    if (row.status !== "pending")
      throw new HttpError(409, "SUGGESTION_BATCH_REVIEWED", "批量校订已审核");
    let document: DocumentEnvelope | null = null;
    if (decision === "approve") {
      const current = this.#documents.get(row.document_id);
      const merged = expectedBatchDocument(
        current.content,
        row.chapter_id,
        JSON.parse(row.before_content_json) as TiptapDocument,
        JSON.parse(row.after_content_json) as TiptapDocument,
      );
      if (!merged)
        throw new HttpError(
          409,
          "BATCH_CHAPTER_CONFLICT",
          "当前章节已变化，无法安全应用整章批次",
          { currentRevision: current.revision, batchRevision: row.base_revision },
        );
      const rebasedSteps = diffDocuments(
        current.content as unknown as JSONContent,
        merged as unknown as JSONContent,
      ) as unknown as Array<Record<string, unknown>>;
      document = this.#documents.applySuggestionBatch(
        row.document_id,
        baseRevision,
        row.id,
        rebasedSteps,
        row.chapter_id,
        identity.id,
      );
    }
    row.status = decision === "approve" ? "approved" : "rejected";
    row.reviewer_id = identity.id;
    this.#db
      .prepare(
        "UPDATE suggestion_batches SET status = ?, reviewer_id = ?, reviewed_at = ? WHERE id = ?",
      )
      .run(row.status, identity.id, new Date().toISOString(), row.id);
    return { batch: mapSuggestionBatch(row), document };
  }

  /** 新建 pending 建议；旧客户端不传定位字段时按空章节/0 行存储。 */
  createSuggestion(
    documentId: string,
    fromText: string,
    toText: string,
    reason: string,
    identity: RequestIdentity,
    location: {
      chapterId: string;
      chapterTitle: string;
      lineNo: number;
      lineText: string;
    },
  ) {
    this.#documents.get(documentId);
    const row: SuggestionRow = {
      id: randomUUID(),
      document_id: documentId,
      chapter_id: location.chapterId || null,
      chapter_title: location.chapterTitle,
      line_no: location.lineNo,
      line_text: location.lineText,
      from_text: fromText,
      to_text: toText,
      reason,
      status: "pending",
      author_id: identity.id,
      reviewer_id: null,
      created_at: new Date().toISOString(),
    };
    this.#db
      .prepare(
        "INSERT INTO suggestions(id, document_id, chapter_id, chapter_title, line_no, line_text, from_text, to_text, reason, status, author_id, reviewer_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?)",
      )
      .run(
        row.id,
        row.document_id,
        row.chapter_id,
        row.chapter_title,
        row.line_no,
        row.line_text,
        row.from_text,
        row.to_text,
        row.reason,
        row.author_id,
        row.created_at,
      );
    return mapSuggestion(row);
  }

  /** 审核建议；通过时合并到正文并创建真实修订。 */
  reviewSuggestion(
    suggestionId: string,
    decision: "approve" | "reject",
    baseRevision: number,
    identity: RequestIdentity,
  ): {
    suggestion: ReturnType<typeof mapSuggestion>;
    document: DocumentEnvelope | null;
  } {
    if (identity.role === "reader")
      throw new HttpError(403, "FORBIDDEN", "只有作者或版主可以审核建议");
    const row = this.#db
      .prepare("SELECT * FROM suggestions WHERE id = ?")
      .get(suggestionId) as unknown as SuggestionRow | undefined;
    if (!row)
      throw new HttpError(404, "SUGGESTION_NOT_FOUND", "纠错建议不存在");
    if (row.status !== "pending")
      throw new HttpError(409, "SUGGESTION_REVIEWED", "纠错建议已审核");
    let document: DocumentEnvelope | null = null;
    if (decision === "approve") {
      const current = this.#documents.get(row.document_id);
      if (current.revision !== baseRevision)
        throw new HttpError(
          409,
          "REVISION_CONFLICT",
          "正文已变化，请重新核对建议",
          { currentRevision: current.revision, baseRevision },
        );
      const replaced = replaceFirstText(
        current.content,
        row.from_text,
        row.to_text,
      );
      if (!replaced)
        throw new HttpError(
          404,
          "SUGGESTION_SOURCE_NOT_FOUND",
          "当前正文已找不到待替换文字",
        );
      document = this.#documents.applySuggestion(
        row.document_id,
        baseRevision,
        suggestionId,
        replaced,
        identity.id,
      );
    }
    row.status = decision === "approve" ? "approved" : "rejected";
    row.reviewer_id = identity.id;
    this.#db
      .prepare(
        "UPDATE suggestions SET status = ?, reviewer_id = ?, reviewed_at = ? WHERE id = ?",
      )
      .run(row.status, identity.id, new Date().toISOString(), row.id);
    return { suggestion: mapSuggestion(row), document };
  }

  /** 按已回复记录解析隐藏内容。 */
  replyGate(
    gateId: string,
    documentId: string,
    identity: RequestIdentity,
  ): { visible: boolean; content: TiptapDocument | null; message: string } {
    const row = this.#db
      .prepare("SELECT document_id, content_json FROM reply_gates WHERE id = ?")
      .get(gateId) as { document_id: string; content_json: string } | undefined;
    if (!row || row.document_id !== documentId)
      throw new HttpError(404, "REPLY_GATE_NOT_FOUND", "回复可见内容不存在");
    const visible =
      identity.role !== "reader" ||
      Boolean(
        this.#db
          .prepare(
            "SELECT 1 FROM reply_receipts WHERE document_id = ? AND user_id = ?",
          )
          .get(documentId, identity.id),
      );
    return {
      visible,
      content: visible
        ? (JSON.parse(row.content_json) as TiptapDocument)
        : null,
      message: visible ? "已满足查看条件" : "回复主帖后可见",
    };
  }

  /** 读取附件并根据身份隐藏下载地址。 */
  attachment(attachmentId: string, identity: RequestIdentity) {
    const row = this.#db
      .prepare("SELECT * FROM attachments WHERE id = ?")
      .get(attachmentId) as unknown as AttachmentRow | undefined;
    if (!row) throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "附件不存在");
    const purchased =
      identity.id === row.author_id ||
      identity.role === "moderator" ||
      Boolean(
        this.#db
          .prepare(
            "SELECT 1 FROM attachment_purchases WHERE attachment_id = ? AND buyer_id = ?",
          )
          .get(attachmentId, identity.id),
      );
    return {
      id: row.id,
      name: row.name,
      mimeType: row.mime_type,
      price: row.price,
      purchased,
      downloadUrl: purchased ? row.download_url : null,
    };
  }

  /** 幂等购买附件，并按售价向作者记入 70%。 */
  purchaseAttachment(attachmentId: string, identity: RequestIdentity) {
    const attachment = this.#db
      .prepare("SELECT * FROM attachments WHERE id = ?")
      .get(attachmentId) as unknown as AttachmentRow | undefined;
    if (!attachment)
      throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "附件不存在");
    const existing = this.#db
      .prepare(
        "SELECT author_income FROM attachment_purchases WHERE attachment_id = ? AND buyer_id = ?",
      )
      .get(attachmentId, identity.id) as { author_income: number } | undefined;
    if (
      existing ||
      identity.id === attachment.author_id ||
      identity.role === "moderator"
    ) {
      const balance = this.#wallet(identity.id);
      return {
        attachment: this.attachment(attachmentId, identity),
        buyerBalance: balance,
        authorIncome: existing?.author_income ?? 0,
        alreadyPurchased: true,
      };
    }
    const balance = this.#wallet(identity.id);
    if (balance < attachment.price)
      throw new HttpError(402, "INSUFFICIENT_COINS", "金币不足", {
        balance,
        price: attachment.price,
      });
    const income = Math.floor(attachment.price * 0.7);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db
        .prepare("UPDATE wallets SET balance = balance - ? WHERE user_id = ?")
        .run(attachment.price, identity.id);
      this.#db
        .prepare("UPDATE wallets SET balance = balance + ? WHERE user_id = ?")
        .run(income, attachment.author_id);
      this.#db
        .prepare(
          "INSERT INTO attachment_purchases(attachment_id, buyer_id, price, author_income, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          attachment.id,
          identity.id,
          attachment.price,
          income,
          new Date().toISOString(),
        );
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return {
      attachment: this.attachment(attachmentId, identity),
      buyerBalance: balance - attachment.price,
      authorIncome: income,
      alreadyPurchased: false,
    };
  }

  /** 读取投票及当前身份选择。 */
  poll(pollId: string, identity: RequestIdentity) {
    const poll = this.#db
      .prepare("SELECT * FROM polls WHERE id = ?")
      .get(pollId) as unknown as PollRow | undefined;
    if (!poll) throw new HttpError(404, "POLL_NOT_FOUND", "投票不存在");
    const options = this.#db
      .prepare(
        "SELECT o.id, o.label, COUNT(vo.option_id) AS votes FROM poll_options o LEFT JOIN poll_vote_options vo ON vo.option_id = o.id WHERE o.poll_id = ? GROUP BY o.id, o.label, o.sort_order ORDER BY o.sort_order",
      )
      .all(pollId) as Array<{ id: string; label: string; votes: number }>;
    const viewer = this.#db
      .prepare(
        "SELECT vo.option_id FROM poll_votes v JOIN poll_vote_options vo ON vo.vote_id = v.id WHERE v.poll_id = ? AND v.user_id = ?",
      )
      .all(pollId, identity.id) as Array<{ option_id: string }>;
    return {
      id: poll.id,
      question: poll.question,
      multiple: poll.multiple === 1,
      eligible: this.#eligible(identity.role, poll.minimum_role),
      options: options.map((item) => ({ ...item, votes: Number(item.votes) })),
      viewerOptionIds: viewer.map((item) => item.option_id),
    };
  }

  /** 提交或覆盖当前身份的投票选择。 */
  votePoll(pollId: string, optionIds: string[], identity: RequestIdentity) {
    const current = this.poll(pollId, identity);
    if (!current.eligible)
      throw new HttpError(403, "POLL_INELIGIBLE", "当前身份不满足投票要求");
    if (!current.multiple && optionIds.length !== 1)
      throw new HttpError(422, "POLL_SINGLE_CHOICE", "该投票只能选择一个选项");
    const unique = [...new Set(optionIds)];
    if (
      unique.some((id) => !current.options.some((option) => option.id === id))
    )
      throw new HttpError(
        404,
        "POLL_OPTION_NOT_FOUND",
        "提交了不属于该投票的选项",
      );
    const existing = this.#db
      .prepare("SELECT id FROM poll_votes WHERE poll_id = ? AND user_id = ?")
      .get(pollId, identity.id) as { id: string } | undefined;
    const voteId = existing?.id ?? randomUUID();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      if (existing) {
        this.#db
          .prepare("DELETE FROM poll_vote_options WHERE vote_id = ?")
          .run(voteId);
        this.#db
          .prepare("UPDATE poll_votes SET created_at = ? WHERE id = ?")
          .run(new Date().toISOString(), voteId);
      } else
        this.#db
          .prepare(
            "INSERT INTO poll_votes(id, poll_id, user_id, created_at) VALUES (?, ?, ?, ?)",
          )
          .run(voteId, pollId, identity.id, new Date().toISOString());
      const insert = this.#db.prepare(
        "INSERT INTO poll_vote_options(vote_id, option_id) VALUES (?, ?)",
      );
      for (const optionId of unique) insert.run(voteId, optionId);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return this.poll(pollId, identity);
  }

  /** 分页读取实名投票。 */
  pollVotes(pollId: string, cursor: string | undefined, limit: number) {
    this.poll(pollId, {
      id: "reader",
      name: "",
      role: "reader",
      isFriend: false,
      bio: "",
    });
    const rows = this.#db
      .prepare(
        "SELECT v.id, v.user_id, v.created_at, u.name, u.role, u.is_friend, u.bio FROM poll_votes v JOIN users u ON u.id = v.user_id WHERE v.poll_id = ? ORDER BY v.created_at DESC, v.id DESC",
      )
      .all(pollId) as Array<{
      id: string;
      user_id: string;
      created_at: string;
      name: string;
      role: "author" | "reader" | "moderator";
      is_friend: number;
      bio: string;
    }>;
    let start = 0;
    if (cursor) {
      const index = rows.findIndex((row) => row.id === cursor);
      if (index < 0)
        throw new HttpError(422, "INVALID_CURSOR", "投票 cursor 无效");
      start = index + 1;
    }
    const page = rows.slice(start, start + limit);
    return {
      items: page.map((row) => ({
        user: mapUser({
          id: row.user_id,
          name: row.name,
          role: row.role,
          is_friend: row.is_friend,
          bio: row.bio,
        }),
        optionIds: (
          this.#db
            .prepare(
              "SELECT option_id FROM poll_vote_options WHERE vote_id = ? ORDER BY option_id",
            )
            .all(row.id) as Array<{ option_id: string }>
        ).map((item) => item.option_id),
        createdAt: row.created_at,
      })),
      pageInfo: {
        nextCursor: start + limit < rows.length ? page.at(-1)!.id : null,
      },
    };
  }

  #wallet(userId: string): number {
    const row = this.#db
      .prepare("SELECT balance FROM wallets WHERE user_id = ?")
      .get(userId) as { balance: number } | undefined;
    return row?.balance ?? 0;
  }

  #eligible(role: RequestIdentity["role"], minimum: string): boolean {
    const rank = { reader: 1, author: 2, moderator: 3 } as const;
    return rank[role] >= (rank[minimum as keyof typeof rank] ?? 99);
  }
}
