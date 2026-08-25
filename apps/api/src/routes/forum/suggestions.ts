import type { FastifyPluginAsync } from "fastify";
import {
  CreateSuggestionRequestSchema,
  ReviewSuggestionRequestSchema,
} from "@ricetext/contracts";
import type { RouteDependencies } from "../dependencies.js";
import { getFastifySchema, identity, params } from "../route-utils.js";

/** 校订建议的查询、提交和审核路由。 */
export const forumSuggestionRoutes: FastifyPluginAsync<
  RouteDependencies
> = async (app, dependencies) => {
  app.get(
    "/api/forum/documents/:documentId/suggestions",
    { schema: getFastifySchema("listSuggestions") },
    async (request) => ({
      items: dependencies.forum.suggestions(
        params(request).documentId!,
        identity(dependencies, request),
      ),
    }),
  );

  app.post(
    "/api/forum/documents/:documentId/suggestions",
    { schema: getFastifySchema("createSuggestion") },
    async (request, reply) => {
      const body = CreateSuggestionRequestSchema.parse(request.body);
      return reply
        .status(201)
        .send(
          dependencies.forum.createSuggestion(
            params(request).documentId!,
            body.fromText,
            body.toText,
            body.reason,
            identity(dependencies, request),
            {
              chapterId: body.chapterId,
              chapterTitle: body.chapterTitle,
              lineNo: body.lineNo,
              lineText: body.lineText,
            },
          ),
        );
    },
  );

  app.patch(
    "/api/forum/suggestions/:suggestionId",
    { schema: getFastifySchema("reviewSuggestion") },
    async (request) => {
      const body = ReviewSuggestionRequestSchema.parse(request.body);
      return dependencies.forum.reviewSuggestion(
        params(request).suggestionId!,
        body.decision,
        body.baseRevision,
        identity(dependencies, request),
      );
    },
  );
};
