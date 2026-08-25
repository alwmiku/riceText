import type { FastifyPluginAsync } from "fastify";
import {
  CursorQuerySchema,
  RollbackDocumentRequestSchema,
  UpdateDocumentRequestSchema,
  UpdateDocumentStepsRequestSchema,
} from "@ricetext/contracts";
import type { RouteDependencies } from "./dependencies.js";
import {
  getFastifySchema,
  params,
  query,
  requireEditor,
} from "./route-utils.js";

/** 文档正文、版本历史和非破坏回滚路由。 */
export const documentRoutes: FastifyPluginAsync<RouteDependencies> = async (
  app,
  dependencies,
) => {
  app.get(
    "/api/documents/:documentId",
    { schema: getFastifySchema("getDocument") },
    async (request) => dependencies.documents.get(params(request).documentId!),
  );

  app.put(
    "/api/documents/:documentId",
    { schema: getFastifySchema("updateDocument") },
    async (request, reply) => {
      const user = requireEditor(dependencies, request);
      const body = UpdateDocumentRequestSchema.parse(request.body);
      const result = dependencies.documents.save(
        params(request).documentId!,
        body,
        user.id,
      );
      return reply.status(result.created ? 201 : 200).send(result.envelope);
    },
  );

  app.get(
    "/api/documents/:documentId/revisions",
    { schema: getFastifySchema("listRevisions") },
    async (request) => {
      const input = CursorQuerySchema.parse(query(request));
      return dependencies.documents.revisions(
        params(request).documentId!,
        input.cursor,
        input.limit,
      );
    },
  );

  app.post(
    "/api/documents/:documentId/rollback",
    { schema: getFastifySchema("rollbackDocument") },
    async (request, reply) => {
      const user = requireEditor(dependencies, request);
      const body = RollbackDocumentRequestSchema.parse(request.body);
      const result = dependencies.documents.rollback(
        params(request).documentId!,
        body,
        user.id,
      );
      return reply.status(result.created ? 201 : 200).send(result.envelope);
    },
  );

  // 客户端提交最小 transaction steps，服务端完整运行 ProseMirror 应用。
  app.patch(
    "/api/documents/:documentId/steps",
    { schema: getFastifySchema("updateDocumentSteps") },
    async (request, reply) => {
      const user = requireEditor(dependencies, request);
      const body = UpdateDocumentStepsRequestSchema.parse(request.body);
      const result = dependencies.documents.applySteps(
        params(request).documentId!,
        body,
        user.id,
      );
      return reply.status(result.created ? 201 : 200).send(result.envelope);
    },
  );
};
