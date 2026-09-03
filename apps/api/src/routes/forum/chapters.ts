import type { FastifyPluginAsync } from "fastify";
import {
  convertLongTextBlocksToChapters,
  type JSONContent,
} from "@ricetext/document-core";
import {
  EntityIdSchema,
  SaveNovelChapterRequestSchema,
  SaveNovelChaptersBatchRequestSchema,
  StageNovelChapterReorderRequestSchema,
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

/** 批量请求的实际序列化大小上限（与契约描述一致，约 5 MiB）。 */
const BATCH_BODY_LIMIT = 5 * 1024 * 1024;

/** 章节目录、差异同步、单章保存与批量上传路由（契约单一来源）。 */
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

  app.post(
    "/api/forum/novels/:novelId/chapters/batch",
    { schema: getFastifySchema("saveNovelChaptersBatch"), bodyLimit: BATCH_BODY_LIMIT },
    async (request) => {
      requireEditor(dependencies, request, params(request).novelId!);
      const body = SaveNovelChaptersBatchRequestSchema.parse(request.body);
      assertBatchSize(request);
      return {
        chapters: dependencies.forum.saveChaptersBatch(
          params(request).novelId!,
          body.chapters.map((chapter) => ({
            id: chapter.id,
            title: chapter.title,
            order: chapter.order,
            content: sanitizeDocument(
              convertLongTextBlocksToChapters(
                chapter.content as unknown as JSONContent,
              ),
            ),
            hash: chapter.hash,
            baseRevision: chapter.baseRevision,
          })),
        ),
      };
    },
  );

  app.post(
    "/api/forum/novels/:novelId/chapters/reorder-stage",
    { schema: getFastifySchema("stageNovelChapterReorder"), bodyLimit: BATCH_BODY_LIMIT },
    async (request) => {
      requireEditor(dependencies, request, params(request).novelId!);
      const body = StageNovelChapterReorderRequestSchema.parse(request.body);
      assertBatchSize(request);
      return {
        chapters: dependencies.forum.stageChapterReorder(
          params(request).novelId!,
          body.chapters,
        ),
      };
    },
  );
}

/**
 * 对实际序列化大小做二道校验：Fastify 的 bodyLimit 基于请求流字节数，
 * 这里再按解析后的 JS 对象重新序列化核对，保证 chunked/无 Content-Length
 * 请求也命中同一上限，返回稳定的 413 错误码。
 */
function assertBatchSize(request: { body: unknown }): void {
  const bytes = new TextEncoder().encode(
    JSON.stringify(request.body ?? null),
  ).byteLength;
  if (bytes > BATCH_BODY_LIMIT) {
    throw new HttpError(
      413,
      "CHAPTER_BATCH_TOO_LARGE",
      "批量请求体超过 5 MiB 上限，请缩小批次或拆分章节正文",
      { bytes, limit: BATCH_BODY_LIMIT },
    );
  }
};
