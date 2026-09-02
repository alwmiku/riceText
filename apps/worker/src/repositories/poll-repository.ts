import {
  ForumUserSchema,
  PollSchema,
  PollVotePageSchema,
  type ForumUser,
  type Poll,
} from "@ricetext/contracts";
import { WorkerHttpError } from "../http-error";

type PollRow = { id: string; question: string; multiple: number; minimum_role: string };
type OptionRow = { id: string; label: string; votes: number };
type VoteRow = {
  id: string;
  user_id: string;
  created_at: string;
  name: string;
  role: "author" | "reader" | "moderator";
  is_friend: number;
  bio: string;
};

const roleRank = { reader: 1, author: 2, moderator: 3 } as const;

/** 投票仓储；选票与选项在同一 D1 batch 中覆盖，避免出现半张选票。 */
export class D1PollRepository {
  constructor(private readonly db: D1Database) {}

  private eligible(role: ForumUser["role"], minimum: string): boolean {
    return roleRank[role] >= (roleRank[minimum as keyof typeof roleRank] ?? 99);
  }

  async poll(pollId: string, principal: ForumUser): Promise<Poll> {
    const poll = await this.db
      .prepare("SELECT id, question, multiple, minimum_role FROM polls WHERE id = ?")
      .bind(pollId)
      .first<PollRow>();
    if (!poll) throw new WorkerHttpError(404, "POLL_NOT_FOUND", "投票不存在");
    const [options, viewer] = await Promise.all([
      this.db
        .prepare(
          "SELECT option.id, option.label, COUNT(selected.option_id) AS votes " +
            "FROM poll_options option " +
            "LEFT JOIN poll_vote_options selected ON selected.option_id = option.id " +
            "WHERE option.poll_id = ? " +
            "GROUP BY option.id, option.label, option.sort_order ORDER BY option.sort_order",
        )
        .bind(pollId)
        .all<OptionRow>(),
      this.db
        .prepare(
          "SELECT selected.option_id FROM poll_votes vote " +
            "JOIN poll_vote_options selected ON selected.vote_id = vote.id " +
            "WHERE vote.poll_id = ? AND vote.user_id = ? ORDER BY selected.option_id",
        )
        .bind(pollId, principal.id)
        .all<{ option_id: string }>(),
    ]);
    return PollSchema.parse({
      id: poll.id,
      question: poll.question,
      multiple: poll.multiple === 1,
      eligible: this.eligible(principal.role, poll.minimum_role),
      options: options.results.map((item) => ({
        id: item.id,
        label: item.label,
        votes: Number(item.votes),
      })),
      viewerOptionIds: viewer.results.map((item) => item.option_id),
    });
  }

  async submit(pollId: string, optionIds: string[], principal: ForumUser): Promise<Poll> {
    const current = await this.poll(pollId, principal);
    if (!current.eligible) {
      throw new WorkerHttpError(403, "POLL_INELIGIBLE", "当前身份不满足投票要求");
    }
    const unique = [...new Set(optionIds)];
    if (!current.multiple && unique.length !== 1) {
      throw new WorkerHttpError(422, "POLL_SINGLE_CHOICE", "该投票只能选择一个选项");
    }
    if (unique.some((id) => !current.options.some((option) => option.id === id))) {
      throw new WorkerHttpError(
        404,
        "POLL_OPTION_NOT_FOUND",
        "提交了不属于该投票的选项",
      );
    }
    const voteId = pollId + ":" + principal.id;
    const createdAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          "INSERT INTO poll_votes(id, poll_id, user_id, created_at) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT(poll_id, user_id) DO UPDATE SET created_at = excluded.created_at",
        )
        .bind(voteId, pollId, principal.id, createdAt),
      this.db.prepare("DELETE FROM poll_vote_options WHERE vote_id = ?").bind(voteId),
    ];
    for (const optionId of unique) {
      statements.push(
        this.db
          .prepare("INSERT INTO poll_vote_options(vote_id, option_id) VALUES (?, ?)")
          .bind(voteId, optionId),
      );
    }
    await this.db.batch(statements);
    return this.poll(pollId, principal);
  }

  async votes(
    pollId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<ReturnType<typeof PollVotePageSchema.parse>> {
    const poll = await this.db
      .prepare("SELECT 1 AS found FROM polls WHERE id = ?")
      .bind(pollId)
      .first<{ found: number }>();
    if (!poll) throw new WorkerHttpError(404, "POLL_NOT_FOUND", "投票不存在");
    const result = await this.db
      .prepare(
        "SELECT vote.id, vote.user_id, vote.created_at, user.name, user.role, " +
          "user.is_friend, user.bio FROM poll_votes vote " +
          "JOIN users user ON user.id = vote.user_id " +
          "WHERE vote.poll_id = ? ORDER BY vote.created_at DESC, vote.id DESC",
      )
      .bind(pollId)
      .all<VoteRow>();
    let start = 0;
    if (cursor) {
      const index = result.results.findIndex((row) => row.id === cursor);
      if (index < 0) throw new WorkerHttpError(422, "INVALID_CURSOR", "投票 cursor 无效");
      start = index + 1;
    }
    const page = result.results.slice(start, start + limit);
    const optionResult =
      page.length === 0
        ? { results: [] as { vote_id: string; option_id: string }[] }
        : await this.db
            .prepare(
              "SELECT vote_id, option_id FROM poll_vote_options " +
                "WHERE vote_id IN (SELECT value FROM json_each(?)) ORDER BY option_id",
            )
            .bind(JSON.stringify(page.map((row) => row.id)))
            .all<{ vote_id: string; option_id: string }>();
    const optionMap = new Map<string, string[]>();
    for (const item of optionResult.results) {
      const list = optionMap.get(item.vote_id) ?? [];
      list.push(item.option_id);
      optionMap.set(item.vote_id, list);
    }
    return PollVotePageSchema.parse({
      items: page.map((row) => ({
        user: ForumUserSchema.parse({
          id: row.user_id,
          name: row.name,
          role: row.role,
          isFriend: row.is_friend === 1,
          bio: row.bio,
        }),
        optionIds: optionMap.get(row.id) ?? [],
        createdAt: row.created_at,
      })),
      pageInfo: {
        nextCursor: start + limit < result.results.length ? page.at(-1)!.id : null,
      },
    });
  }
}
