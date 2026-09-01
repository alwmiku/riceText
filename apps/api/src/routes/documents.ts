import type { FastifyPluginAsync } from "fastify";
import {
  CreateDocumentChapterRequestSchema,
  RevisionQuerySchema,
  RollbackDocumentRequestSchema,
  UpdateDocumentChapterRequestSchema,
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
      const input = RevisionQuerySchema.parse(query(request));
      return dependencies.documents.revisions(
        params(request).documentId!,
        input.cursor,
        input.limit,
        input.chapterId,
      );
    },
  );

  app.get(
    "/api/documents/:documentId/revisions/:revision",
    { schema: getFastifySchema("getRevision") },
    async (request) =>
      dependencies.documents.revision(
        params(request).documentId!,
        Number(params(request).revision),
      ),
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

  // 隐藏/恢复章节：隐藏后读者不可读，作者写完取消隐藏后恢复可读。
  app.patch(
    "/api/documents/:documentId/chapters/:chapterId",
    { schema: getFastifySchema("updateDocumentChapter") },
    async (request, reply) => {
      requireEditor(dependencies, request);
      const body = UpdateDocumentChapterRequestSchema.parse(request.body);
      const documentId = params(request).documentId!;
      dependencies.documents.get(documentId);
      return reply
        .status(200)
        .send(
          dependencies.forum.updateChapterHidden(
            documentId,
            params(request).chapterId!,
            body.hidden,
          ),
        );
    },
  );

  // 编辑器「删除章节」移出正文后调用本接口删除对应目录行（幂等），
  // 历史修订与版本号不受影响；关联校订建议解除归属但不删除。
  app.delete(
    "/api/documents/:documentId/chapters/:chapterId",
    { schema: getFastifySchema("deleteDocumentChapter") },
    async (request) => {
      requireEditor(dependencies, request);
      const documentId = params(request).documentId!;
      dependencies.documents.get(documentId);
      return dependencies.forum.deleteChapter(
        documentId,
        params(request).chapterId!,
      );
    },
  );

  // 编辑器「新增章节」只改正文；保存前客户端先把新章节注册进服务器目录，
  // 并把返回的服务器 id 同步回本地，再用该 id 保存文档（历史与版本号按 id 归集）。
  app.post(
    "/api/documents/:documentId/chapters",
    { schema: getFastifySchema("createDocumentChapter") },
    async (request, reply) => {
      requireEditor(dependencies, request);
      const body = CreateDocumentChapterRequestSchema.parse(request.body);
      const documentId = params(request).documentId!;
      dependencies.documents.get(documentId);
      const chapter = dependencies.forum.createChapter(documentId, body);
      return reply.status(201).send(chapter);
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
