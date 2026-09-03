import type { FastifyPluginAsync } from "fastify";
import {
  convertLongTextBlocksToChapters,
  type JSONContent,
} from "@ricetext/document-core";
import {
  EntityIdSchema,
  SaveNovelChapterRequestSchema,
  SyncNovelChaptersRequestSchema,
} from "@ricetext/contracts";
import { sanitizeDocument } from "../../document-service.js";
import { HttpError } from "../../errors.js";
import type { RouteDependencies } from "../dependencies.js";
import {
  canEditDocument,
  getFastifySchema,
  identity,
  params,
  query,
  requireEditor,
} from "../route-utils.js";

/** 章节目录、差异同步和单章保存路由（契约单一来源）。 */
export const forumChapterRoutes: FastifyPluginAsync<RouteDependencies> = async (
  app,
  dependencies,
) => {
  app.get(
    "/api/forum/chapters",
    { schema: getFastifySchema("listChapters") },
    async (request) => {
      const user = identity(dependencies, request);
      const documentId = EntityIdSchema.parse(query(request).documentId);
      return {
        items: dependencies.forum
          .chapters(documentId)
          .filter(
            (chapter) =>
              !chapter.hidden ||
              canEditDocument(dependencies, user, chapter.documentId),
          ),
      };
    },
  );

  app.post(
    "/api/forum/novels/:novelId/chapters/sync",
    { schema: getFastifySchema("syncNovelChapters") },
    async (request) => {
      requireEditor(dependencies, request, params(request).novelId!);
      const body = SyncNovelChaptersRequestSchema.parse(request.body);
      const serverHashes = dependencies.forum.chapterHashes(
        params(request).novelId!,
      );
      const toUpdate = body.chapters
        .filter((chapter) => serverHashes.get(chapter.id) !== chapter.hash)
        .map((chapter) => chapter.id);
      return { toUpdate, existing: [...serverHashes.keys()] };
    },
  );

  app.get(
    "/api/forum/novels/:novelId/chapters/:chapterId",
    { schema: getFastifySchema("getNovelChapter") },
    async (request) => {
      const user = identity(dependencies, request);
      const chapter = dependencies.forum.chapterContent(
        params(request).novelId!,
        params(request).chapterId!,
      );
      if (
        chapter.hidden &&
        !canEditDocument(dependencies, user, chapter.documentId)
      )
        throw new HttpError(404, "CHAPTER_NOT_FOUND", "章节正文不存在");
      return chapter;
    },
  );

  app.put(
    "/api/forum/novels/:novelId/chapters/:chapterId",
    { schema: getFastifySchema("saveNovelChapter") },
    async (request, reply) => {
      requireEditor(dependencies, request, params(request).novelId!);
      const body = SaveNovelChapterRequestSchema.parse(request.body);
      const saved = dependencies.forum.saveChapter(
        params(request).novelId!,
        params(request).chapterId!,
        {
          title: body.title,
          order: body.order,
          content: sanitizeDocument(
            convertLongTextBlocksToChapters(
              body.content as unknown as JSONContent,
            ),
          ),
          hash: body.hash,
          baseRevision: body.baseRevision,
        },
      );
      return reply.status(201).send(saved);
    },
  );
};
