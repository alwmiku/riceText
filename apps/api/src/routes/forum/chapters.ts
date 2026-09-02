import type { FastifyPluginAsync } from "fastify";
import {
  SaveNovelChapterRequestSchema,
  SyncNovelChaptersRequestSchema,
} from "@ricetext/contracts";
import { sanitizeDocument } from "../../document-service.js";
import type { RouteDependencies } from "../dependencies.js";
import {
  canEditDocument,
  getFastifySchema,
  identity,
  params,
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
      return {
        items: dependencies.forum
          .chapters()
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
          content: sanitizeDocument(body.content),
          hash: body.hash,
          baseRevision: body.baseRevision,
        },
      );
      return reply.status(201).send(saved);
    },
  );
};
