import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyPluginAsync } from "fastify";
import {
  EMOJI_CATALOG,
  EMOJI_GROUPS,
  emojiAssetFileName,
  emojiAssetMimeType,
  emojiThumbnailFileName,
  emojiThumbnailMimeType,
} from "@ricetext/contracts";
import { HttpError } from "../errors.js";
import type { RouteDependencies } from "./dependencies.js";
import { getFastifySchema, params } from "./route-utils.js";

/**
 * 站点自定义表情的图片路由。
 *
 * 图片是随仓库提交的静态资源（`src/assets/emoji/`，沿用表情包原文件名，含动图），
 * 不是用户上传，因此不需要数据库：id 是否可用完全由 @ricetext/contracts 的表情
 * 目录决定，目录里没声明的 id 一律 404，天然免疫路径穿越。
 */
export const emojiRoutes: FastifyPluginAsync<RouteDependencies> = async (app) => {
  // 目录是站点常量，直接由 @ricetext/contracts 提供；路由存在的意义是让
  // 客户端走同一套契约客户端，而不是把常量复制一份到 apps/web。
  app.get(
    "/api/emoji",
    { schema: getFastifySchema("listEmojiCatalog") },
    async (_request, reply) => {
      reply.header("cache-control", "public, max-age=3600");
      return { groups: EMOJI_GROUPS, items: EMOJI_CATALOG };
    },
  );

  app.get(
    "/api/emoji/:emojiId/image",
    { schema: getFastifySchema("readEmojiImage") },
    async (request, reply) => {
      const emojiId = params(request).emojiId!;
      const fileName = emojiAssetFileName(emojiId);
      const mimeType = emojiAssetMimeType(emojiId);
      if (!fileName || !mimeType) {
        throw new HttpError(404, "EMOJI_NOT_FOUND", "表情不存在或没有图片资源");
      }
      // ?frame=first：返回构建期生成的首帧缩略图，供面板/候选浮层使用，
      // 避免同时解码十几张 500×500 的动图。
      const wantsStaticFrame = (request.query as { frame?: string } | undefined)?.frame === "first";
      const targets = wantsStaticFrame
        ? [
            {
              fileName: emojiThumbnailFileName(emojiId),
              mimeType: emojiThumbnailMimeType(emojiId),
              directory: "thumbs",
            },
          ]
        : [
            { fileName, mimeType, directory: "" },
            // 动图没有缩略图时仍可退回完整图片。
            {
              fileName: emojiThumbnailFileName(emojiId),
              mimeType: emojiThumbnailMimeType(emojiId),
              directory: "thumbs",
            },
          ];
      const target = targets.find((candidate) => candidate.fileName && candidate.mimeType);
      if (!target?.fileName || !target.mimeType) {
        throw new HttpError(404, "EMOJI_NOT_FOUND", "表情不存在或没有图片资源");
      }
      let binary: Buffer;
      try {
        binary = await readFile(
          join(import.meta.dirname, "..", "assets", "emoji", target.directory, target.fileName),
        );
      } catch {
        // 目录声明了但资源缺失：对外和「不存在」一样，避免暴露内部文件布局。
        throw new HttpError(404, "EMOJI_NOT_FOUND", "表情不存在或没有图片资源");
      }
      reply
        .type(target.mimeType)
        .header("content-length", binary.length)
        .header("cache-control", "public, max-age=31536000, immutable")
        .header("content-disposition", `inline; filename="${encodeURIComponent(target.fileName)}"`);
      return reply.send(binary);
    },
  );
};
