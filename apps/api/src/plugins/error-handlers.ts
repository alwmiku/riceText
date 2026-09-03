import type { FastifyInstance } from "fastify";
import { HttpError, sendHttpError } from "../errors.js";

/** 注册统一业务错误、校验错误、上传限制和 404 响应。 */
export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    const candidate = error as {
      code?: string;
      validation?: unknown;
      issues?: unknown;
      message?: string;
    };
    if (error instanceof HttpError) return sendHttpError(reply, error);
    if (candidate.code === "FST_ERR_CTP_INVALID_JSON_BODY") {
      return sendHttpError(
        reply,
        new HttpError(422, "VALIDATION_ERROR", "请求体不是有效的 JSON"),
      );
    }
    if (candidate.code === "FST_REQ_FILE_TOO_LARGE") {
      return sendHttpError(
        reply,
        new HttpError(413, "ASSET_TOO_LARGE", "图片不能超过 8 MiB"),
      );
    }
    if (candidate.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return sendHttpError(
        reply,
        new HttpError(
          413,
          "CHAPTER_BATCH_TOO_LARGE",
          "批量请求体超过 5 MiB 上限，请缩小批次或拆分章节正文",
        ),
      );
    }
    if (candidate.validation !== undefined || Array.isArray(candidate.issues)) {
      return sendHttpError(
        reply,
        new HttpError(422, "VALIDATION_ERROR", "请求字段校验失败", {
          issue: candidate.message ?? "字段格式不正确",
        }),
      );
    }
    app.log.error(error);
    return sendHttpError(
      reply,
      new HttpError(500, "INTERNAL_ERROR", "服务器处理请求时发生错误"),
    );
  });

  app.setNotFoundHandler((_request, reply) =>
    sendHttpError(
      reply,
      new HttpError(404, "ROUTE_NOT_FOUND", "请求的接口不存在"),
    ),
  );
}
