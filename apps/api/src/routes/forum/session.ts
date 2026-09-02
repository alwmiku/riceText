import type { FastifyPluginAsync } from "fastify";
import {
  ResolveMentionRequestSchema,
  ResolveReplyGateRequestSchema,
} from "@ricetext/contracts";
import type { RouteDependencies } from "../dependencies.js";
import { getFastifySchema, identity, query } from "../route-utils.js";

/** 论坛身份、用户搜索、提及解析和回复可见解析路由。 */
export const forumSessionRoutes: FastifyPluginAsync<RouteDependencies> = async (
  app,
  dependencies,
) => {
  app.get(
    "/api/forum/session",
    { schema: getFastifySchema("getForumSession") },
    async (request) => ({
      current: dependencies.forum.sessionUser(identity(dependencies, request)),
      available: dependencies.forum.users(),
    }),
  );

  app.get(
    "/api/forum/users/search",
    { schema: getFastifySchema("searchMentionUsers") },
    async (request) => {
      identity(dependencies, request);
      const input = query(request);
      return {
        items: dependencies.forum.searchUsers(
          typeof input.q === "string" ? input.q : "",
          input.friendsOnly === true || input.friendsOnly === "true",
        ),
      };
    },
  );

  app.post(
    "/api/forum/mentions/resolve",
    { schema: getFastifySchema("resolveMention") },
    async (request) => {
      identity(dependencies, request);
      const body = ResolveMentionRequestSchema.parse(request.body);
      return dependencies.forum.resolveMention(body.name, body.userId);
    },
  );

  app.post(
    "/api/forum/reply-gates/resolve",
    { schema: getFastifySchema("resolveReplyGate") },
    async (request) => {
      const body = ResolveReplyGateRequestSchema.parse(request.body);
      return dependencies.forum.replyGate(
        body.gateId,
        body.documentId,
        identity(dependencies, request),
      );
    },
  );
};
