import type { FastifyPluginAsync } from "fastify";
import type { RouteDependencies } from "../dependencies.js";
import { getFastifySchema, identity, params } from "../route-utils.js";

/** 付费附件的状态查询和幂等购买路由。 */
export const forumAttachmentRoutes: FastifyPluginAsync<
  RouteDependencies
> = async (app, dependencies) => {
  app.get(
    "/api/forum/attachments/:attachmentId",
    { schema: getFastifySchema("getAttachment") },
    async (request) =>
      dependencies.forum.attachment(
        params(request).attachmentId!,
        identity(dependencies, request),
      ),
  );

  app.post(
    "/api/forum/attachments/:attachmentId/purchase",
    { schema: getFastifySchema("purchaseAttachment") },
    async (request) =>
      dependencies.forum.purchaseAttachment(
        params(request).attachmentId!,
        identity(dependencies, request),
      ),
  );
};
