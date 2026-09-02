import type { FastifyPluginAsync } from "fastify";
import {
  CommentSortSchema,
  CreateCommentReplyRequestSchema,
  CursorQuerySchema,
  VoteCommentRequestSchema,
} from "@ricetext/contracts";
import type { RouteDependencies } from "./dependencies.js";
import { getFastifySchema, identity, params, query } from "./route-utils.js";

/** 文档锚点间贴、楼中楼回复和赞踩路由。 */
export const commentRoutes: FastifyPluginAsync<RouteDependencies> = async (
  app,
  dependencies,
) => {
  app.get(
    "/api/documents/:documentId/comments/:anchorId",
    { schema: getFastifySchema("getCommentThread") },
    async (request) => {
      const input = query(request);
      const page = CursorQuerySchema.parse({
        ...(typeof input.cursor === "string" ? { cursor: input.cursor } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      });
      const sort = CommentSortSchema.parse(input.sort ?? "score");
      return dependencies.comments.getThread(
        params(request).documentId!,
        params(request).anchorId!,
        identity(dependencies, request).id,
        sort,
        page.cursor,
        page.limit,
      );
    },
  );

  app.post(
    "/api/documents/:documentId/comments/:anchorId/replies",
    { schema: getFastifySchema("createCommentReply") },
    async (request, reply) => {
      const body = CreateCommentReplyRequestSchema.parse(request.body);
      return reply
        .status(201)
        .send(
          dependencies.comments.reply(
            params(request).documentId!,
            params(request).anchorId!,
            body.parentId,
            body.body,
            identity(dependencies, request),
          ),
        );
    },
  );

  app.put(
    "/api/comments/replies/:replyId/vote",
    { schema: getFastifySchema("voteComment") },
    async (request) => {
      const body = VoteCommentRequestSchema.parse(request.body);
      return dependencies.comments.vote(
        params(request).replyId!,
        identity(dependencies, request).id,
        body.value,
      );
    },
  );
};
