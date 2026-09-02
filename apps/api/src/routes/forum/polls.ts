import type { FastifyPluginAsync } from "fastify";
import {
  CursorQuerySchema,
  SubmitPollVoteRequestSchema,
} from "@ricetext/contracts";
import type { RouteDependencies } from "../dependencies.js";
import { getFastifySchema, identity, params, query } from "../route-utils.js";

/** 投票详情、实名投票提交和分页明细路由。 */
export const forumPollRoutes: FastifyPluginAsync<RouteDependencies> = async (
  app,
  dependencies,
) => {
  app.get(
    "/api/forum/polls/:pollId",
    { schema: getFastifySchema("getPoll") },
    async (request) =>
      dependencies.forum.poll(
        params(request).pollId!,
        identity(dependencies, request),
      ),
  );

  app.post(
    "/api/forum/polls/:pollId/votes",
    { schema: getFastifySchema("submitPollVote") },
    async (request) => {
      const body = SubmitPollVoteRequestSchema.parse(request.body);
      return dependencies.forum.votePoll(
        params(request).pollId!,
        body.optionIds,
        identity(dependencies, request),
      );
    },
  );

  app.get(
    "/api/forum/polls/:pollId/votes",
    { schema: getFastifySchema("listPollVotes") },
    async (request) => {
      identity(dependencies, request);
      const input = CursorQuerySchema.parse(query(request));
      return dependencies.forum.pollVotes(
        params(request).pollId!,
        input.cursor,
        input.limit,
      );
    },
  );
};
