import { type Extensions } from "@tiptap/core";
import {
  createDocumentExtensions,
  type DocumentExtensionsOptions,
} from "@ricetext/document-core";
import { AttachmentRef } from "./attachment-ref.js";
import { DiceRoll } from "./dice-roll.js";
import { InlineCommentAnchorSchema } from "./inline-comment-anchor-schema.js";
import { LongTextBlockSchema } from "./long-text-block-schema.js";
import { Mention } from "./mention.js";
import { NovelExcerpt } from "./novel-excerpt.js";
import { PollRefSchema } from "./poll-ref-schema.js";
import { ReplyGate } from "./reply-gate.js";
import { RichImageSchema } from "./rich-image-schema.js";
import { Spoiler } from "./spoiler.js";

/** 保留原 schema 工厂的配置入口。 */
export type SchemaExtensionsOptions = DocumentExtensionsOptions;

/** 基础持久化组合只由 document-core 提供；按名称增强命令和 HTML 行为。 */
export function schemaExtensions(
  options: SchemaExtensionsOptions = {},
): Extensions {
  const enhancements = new Map(
    [
      InlineCommentAnchorSchema,
      RichImageSchema,
      DiceRoll,
      NovelExcerpt,
      Mention,
      ReplyGate,
      AttachmentRef,
      PollRefSchema,
      LongTextBlockSchema,
      Spoiler,
    ].map((extension) => [extension.name, extension]),
  );

  return createDocumentExtensions()
    .map((extension) => enhancements.get(extension.name) ?? extension)
    .concat(options.additionalExtensions ?? []);
}
