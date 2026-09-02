import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { RequestIdentity } from "../auth.js";
import { HttpError } from "../errors.js";
import { mapUser } from "./shared.js";

interface PollRow {
  id: string;
  question: string;
  multiple: number;
  minimum_role: string;
}

export class PollService {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
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
    const unique = [...new Set(optionIds)];
    if (!current.multiple && unique.length !== 1)
      throw new HttpError(422, "POLL_SINGLE_CHOICE", "该投票只能选择一个选项");
    if (
      unique.some((id) => !current.options.some((option) => option.id === id))
    )
      throw new HttpError(
        404,
        "POLL_OPTION_NOT_FOUND",
        "提交了不属于该投票的选项",
      );
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.#db
        .prepare("SELECT id FROM poll_votes WHERE poll_id = ? AND user_id = ?")
        .get(pollId, identity.id) as { id: string } | undefined;
      const voteId = existing?.id ?? randomUUID();
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

  #eligible(role: RequestIdentity["role"], minimum: string): boolean {
    const rank = { reader: 1, author: 2, moderator: 3 } as const;
    return rank[role] >= (rank[minimum as keyof typeof rank] ?? 99);
  }
}
