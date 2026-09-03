import { TiptapDocumentSchema, type TiptapDocument } from "@ricetext/contracts";
import {
  splitDocumentByChapters,
  validateDocument,
  type DocumentValidationIssue,
  type JSONContent,
} from "@ricetext/document-core";
import { DomainError } from "./errors";

const VALIDATION_ERROR_CODES: Record<DocumentValidationIssue["code"], string> = {
  "invalid-document": "INVALID_DOCUMENT",
  "invalid-structure": "INVALID_DOCUMENT",
  "unknown-node": "UNSUPPORTED_NODE",
  "unknown-mark": "UNSUPPORTED_MARK",
  "unknown-attribute": "UNSAFE_ATTRIBUTE",
  "invalid-attribute": "INVALID_ATTRIBUTE",
  "unsafe-url": "UNSAFE_URL",
  "limit-exceeded": "DOCUMENT_TOO_LARGE",
};

/** 严格写边界：净化器发现任何问题都拒绝保存，避免危险内容进入历史版本。 */
export function sanitizeDocumentForWrite(input: unknown): TiptapDocument {
  const parsed = TiptapDocumentSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError(422, "INVALID_DOCUMENT", "正文不是有效的 Tiptap JSON", {
      issue: parsed.error.issues[0]?.message ?? "未知结构错误",
    });
  }
  const result = validateDocument(parsed.data);
  if (!result.valid) {
    const issue = result.issues[0]!;
    throw new DomainError(422, VALIDATION_ERROR_CODES[issue.code], issue.message ?? "文档校验失败", {
      path: issue.path,
    });
  }
  return result.document as unknown as TiptapDocument;
}

/** 容错读边界：清除历史脏数据中的危险字段，避免整篇文档无法读取。 */
export function repairDocumentForRead(input: unknown): TiptapDocument {
  return validateDocument(input).document as unknown as TiptapDocument;
}

/** 返回给读者前按服务端目录移除隐藏章节，不能只依赖前端目录过滤。 */
export function projectDocumentForReader(
  input: unknown,
  hiddenOrders: ReadonlySet<number>,
): TiptapDocument {
  const document = repairDocumentForRead(input);
  if (hiddenOrders.size === 0) return document;
  const split = splitDocumentByChapters(document as unknown as JSONContent);
  const hidden = split.chapters
    .map((chapter, order) => ({ chapter, order }))
    .filter(({ order }) => hiddenOrders.has(order))
    .sort((left, right) => right.chapter.start - left.chapter.start);
  const content = [...document.content];
  for (const { chapter } of hidden) {
    content.splice(chapter.start, chapter.end - chapter.start);
  }
  return repairDocumentForRead({ type: "doc", content });
}
