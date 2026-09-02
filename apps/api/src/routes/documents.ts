import type { FastifyPluginAsync } from "fastify";
import {
  CreateDocumentChapterRequestSchema,
  RevisionQuerySchema,
  RollbackDocumentRequestSchema,
  UpdateDocumentChapterRequestSchema,
  UpdateDocumentRequestSchema,
  UpdateDocumentStepsRequestSchema,
  type DocumentEnvelope,
} from "@ricetext/contracts";
import { projectDocumentForReader } from "@ricetext/server-core";
import type { RequestIdentity } from "../auth.js";
import { HttpError } from "../errors.js";
import type { RouteDependencies } from "./dependencies.js";
import {
  canEditDocument,
  getFastifySchema,
  identity,
  params,
  query,
  requireEditor,
} from "./route-utils.js";

function visibleEnvelope(
  dependencies: RouteDependencies,
  user: RequestIdentity,
  envelope: DocumentEnvelope,
): DocumentEnvelope {
  if (canEditDocument(dependencies, user, envelope.id)) return envelope;
  const rows = dependencies.db
    .prepare("SELECT sort_order FROM chapters WHERE document_id = ? AND hidden = 1")
    .all(envelope.id) as Array<{ sort_order: number }>;
  return {
    ...envelope,
    content: projectDocumentForReader(
      envelope.content,
      new Set(rows.map((row) => row.sort_order)),
    ),
  };
}

/** 文档正文、版本历史和非破坏回滚路由。 */
export const documentRoutes: FastifyPluginAsync<RouteDependencies> = async (
  app,
  dependencies,
) => {
  app.get(
    "/api/documents/:documentId",
    { schema: getFastifySchema("getDocument") },
    async (request) => {
      const user = identity(dependencies, request);
      return visibleEnvelope(
        dependencies,
        user,
        dependencies.documents.get(params(request).documentId!),
      );
    },
  );

  app.put(
    "/api/documents/:documentId",
    { schema: getFastifySchema("updateDocument") },
    async (request, reply) => {
      const documentId = params(request).documentId!;
      const body = UpdateDocumentRequestSchema.parse(request.body);
      const existing = dependencies.db
        .prepare("SELECT 1 AS found FROM documents WHERE id = ?")
        .get(documentId);
      const user = existing
        ? requireEditor(dependencies, request, documentId)
        : identity(dependencies, request);
      if (!existing && user.role === "reader") {
        throw new HttpError(403, "FORBIDDEN", "只有作者或版主可以创建文章");
      }
      const result = dependencies.documents.save(
        documentId,
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
    async (request) => {
      const user = identity(dependencies, request);
      return visibleEnvelope(
        dependencies,
        user,
        dependencies.documents.revision(
          params(request).documentId!,
          Number(params(request).revision),
        ),
      );
    },
  );

  app.post(
    "/api/documents/:documentId/rollback",
    { schema: getFastifySchema("rollbackDocument") },
    async (request, reply) => {
      const user = requireEditor(dependencies, request, params(request).documentId!);
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
      requireEditor(dependencies, request, params(request).documentId!);
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
      requireEditor(dependencies, request, params(request).documentId!);
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
      requireEditor(dependencies, request, params(request).documentId!);
      const body = CreateDocumentChapterRequestSchema.parse(request.body);
      const documentId = params(request).documentId!;
      dependencies.documents.get(documentId);
      const { created, ...chapter } = dependencies.forum.createChapter(documentId, body);
      return reply.status(created ? 201 : 200).send(chapter);
    },
  );

  // 客户端提交最小 transaction steps，服务端完整运行 ProseMirror 应用。
  app.patch(
    "/api/documents/:documentId/steps",
    { schema: getFastifySchema("updateDocumentSteps") },
    async (request, reply) => {
      const user = requireEditor(dependencies, request, params(request).documentId!);
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
