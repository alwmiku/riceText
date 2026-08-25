import type { FastifyPluginAsync } from "fastify";
import { sanitizeDocument } from "../../document-service.js";
import { HttpError } from "../../errors.js";
import type { RouteDependencies } from "../dependencies.js";
import { getFastifySchema, params, requireEditor } from "../route-utils.js";

interface ChapterSyncInput {
  chapters?: Array<{
    id: string;
    title: string;
    order: number;
    hash: string;
  }>;
}

/** 章节目录、差异同步和单章保存路由。 */
export const forumChapterRoutes: FastifyPluginAsync<RouteDependencies> = async (
  app,
  dependencies,
) => {
  app.get(
    "/api/forum/chapters",
    { schema: getFastifySchema("listChapters") },
    async () => ({ items: dependencies.forum.chapters() }),
  );

  app.post("/api/forum/novels/:novelId/chapters/sync", async (request) => {
    const items = (request.body as ChapterSyncInput).chapters ?? [];
    const serverHashes = dependencies.forum.chapterHashes(
      params(request).novelId!,
    );
    const toUpdate = items
      .filter((chapter) => serverHashes.get(chapter.id) !== chapter.hash)
      .map((chapter) => chapter.id);
    return { toUpdate, existing: [...serverHashes.keys()] };
  });

  app.put(
    "/api/forum/novels/:novelId/chapters/:chapterId",
    async (request, reply) => {
      requireEditor(dependencies, request);
      const body = request.body as {
        title?: unknown;
        order?: unknown;
        content?: unknown;
        hash?: unknown;
        baseRevision?: unknown;
      };
      if (
        typeof body.title !== "string" ||
        typeof body.order !== "number" ||
        typeof body.hash !== "string" ||
        typeof body.baseRevision !== "number"
      ) {
        throw new HttpError(422, "INVALID_CHAPTER_SAVE", "章节保存字段无效");
      }
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
