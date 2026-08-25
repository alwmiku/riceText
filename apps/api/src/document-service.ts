import type { DatabaseSync } from "node:sqlite";
import {
  TiptapDocumentSchema,
  ALLOWED_DOCUMENT_FONT_FAMILIES,
  ALLOWED_DOCUMENT_FONT_SIZES,
  DOCUMENT_MARK_ATTRIBUTES,
  DOCUMENT_NODE_ATTRIBUTES,
  collectInlineCommentAnchorIds,
  type DocumentEnvelope,
  type JsonValue,
  type RevisionPage,
  type RollbackDocumentRequest,
  type TiptapDocument,
  type TiptapMark,
  type TiptapNode,
  type UpdateDocumentRequest,
} from "@ricetext/contracts";
import { HttpError } from "./errors.js";

interface DocumentRow {
  id: string;
  title: string;
  schema_version: number;
  current_revision: number;
  updated_at: string;
}

interface RevisionRow {
  revision: number;
  schema_version: number;
  content_json: string;
  author_id: string;
  author_name?: string;
  operation: "seed" | "update" | "rollback" | "suggestion";
  target_revision: number | null;
  created_at: string;
}

/** 每种持久化节点允许的 attrs；未知属性在写入前直接拒绝。 */
const allowedNodeAttrs: Record<string, ReadonlySet<string>> = Object.fromEntries(
  Object.entries(DOCUMENT_NODE_ATTRIBUTES).map(([type, attrs]) => [
    type,
    new Set<string>(attrs),
  ]),
);

/** mark 属性白名单独立于节点，避免任意 style/class/on* 进入正文。 */
const allowedMarkAttrs: Record<string, ReadonlySet<string>> = Object.fromEntries(
  Object.entries(DOCUMENT_MARK_ATTRIBUTES).map(([type, attrs]) => [
    type,
    new Set<string>(attrs),
  ]),
);

const allowedFonts = new Set<string>(ALLOWED_DOCUMENT_FONT_FAMILIES);
const allowedFontSizes = new Set(
  ALLOWED_DOCUMENT_FONT_SIZES.map((size) => `${size}px`),
);

function attrsOf(value: TiptapNode | TiptapMark): Record<string, JsonValue> {
  return value.attrs ?? {};
}

/** 验证属性名；即使值看似无害，也不允许 schema 外字段穿透。 */
function assertAllowedAttrs(
  type: string,
  attrs: Record<string, JsonValue>,
  allowed: ReadonlySet<string>,
): void {
  for (const key of Object.keys(attrs)) {
    if (
      !allowed.has(key) ||
      key === "style" ||
      key === "class" ||
      key.startsWith("on")
    ) {
      throw new HttpError(
        422,
        "UNSAFE_ATTRIBUTE",
        `${type} 不允许属性 ${key}`,
        { nodeType: type, attribute: key },
      );
    }
  }
}

/** 读取长度受限字符串属性；可选 null/undefined 视为未提供。 */
function stringAttr(
  attrs: Record<string, JsonValue>,
  key: string,
  required = false,
  maxLength = 2_000,
): string | undefined {
  const value = attrs[key];
  if ((value === undefined || value === null) && !required) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  )
    throw new HttpError(422, "INVALID_ATTRIBUTE", `${key} 必须是有效字符串`);
  return value;
}

/** 使用 URL 解析器校验 HTTP(S)，不依赖容易绕过的字符串前缀判断。 */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** 校验 mark 的协议、颜色、字号和字体白名单。 */
function validateMark(mark: TiptapMark): void {
  const allowed = allowedMarkAttrs[mark.type];
  if (!allowed)
    throw new HttpError(422, "UNSUPPORTED_MARK", `不支持 mark: ${mark.type}`);
  const attrs = attrsOf(mark);
  assertAllowedAttrs(mark.type, attrs, allowed);
  if (mark.type === "link") {
    const href = stringAttr(attrs, "href", true)!;
    let allowedHref = isHttpUrl(href);
    if (!allowedHref) {
      try {
        allowedHref = new URL(href).protocol === "mailto:";
      } catch {
        allowedHref = false;
      }
    }
    if (!allowedHref)
      throw new HttpError(
        422,
        "UNSAFE_URL",
        "链接仅允许 HTTP(S) 或 mailto 协议",
      );
  }
  const color = attrs.color;
  if (
    color !== undefined &&
    (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color))
  )
    throw new HttpError(422, "INVALID_COLOR", "颜色必须是六位十六进制值");
  const size = attrs.fontSize;
  if (
    size !== undefined &&
    (typeof size !== "string" || !allowedFontSizes.has(size))
  )
    throw new HttpError(422, "INVALID_FONT_SIZE", "字号不在白名单中");
  const family = attrs.fontFamily;
  if (
    family !== undefined &&
    (typeof family !== "string" || !allowedFonts.has(family))
  )
    throw new HttpError(422, "INVALID_FONT_FAMILY", "字体不在白名单中");
}

/** 深度优先校验完整节点树，并限制嵌套深度。 */
function validateNode(node: TiptapNode, depth: number): void {
  if (depth > 100)
    throw new HttpError(422, "DOCUMENT_TOO_DEEP", "正文嵌套层级不能超过 100");
  const allowed = allowedNodeAttrs[node.type];
  if (!allowed)
    throw new HttpError(422, "UNSUPPORTED_NODE", `不支持节点: ${node.type}`);
  const attrs = attrsOf(node);
  assertAllowedAttrs(node.type, attrs, allowed);
  for (const mark of node.marks ?? []) validateMark(mark);

  if (node.type === "text") {
    if (typeof node.text !== "string" || node.content)
      throw new HttpError(
        422,
        "INVALID_TEXT_NODE",
        "text 节点必须仅包含 text 字段",
      );
  } else if (node.text !== undefined) {
    throw new HttpError(
      422,
      "INVALID_NODE_TEXT",
      `${node.type} 不能直接包含 text 字段`,
    );
  }

  if (
    node.type === "heading" &&
    ![1, 2, 3, 4, 5, 6].includes(attrs.level as number)
  )
    throw new HttpError(422, "INVALID_HEADING", "标题级别必须为 1-6");
  if (
    (node.type === "heading" || node.type === "paragraph") &&
    attrs.textAlign !== undefined &&
    attrs.textAlign !== null &&
    !["left", "center", "right", "justify"].includes(String(attrs.textAlign))
  )
    throw new HttpError(422, "INVALID_ALIGNMENT", "文本对齐值无效");
  if (node.type === "richImage") {
    const src = stringAttr(attrs, "src", true)!;
    if (!isHttpUrl(src) && !/^\/api\/assets\/[A-Za-z0-9_-]+$/.test(src))
      throw new HttpError(
        422,
        "UNSAFE_IMAGE_URL",
        "图片仅允许 HTTP(S) 外链或本站资产 URL",
      );
    if (
      attrs.align !== undefined &&
      !["left", "center", "right"].includes(String(attrs.align))
    )
      throw new HttpError(422, "INVALID_IMAGE_ALIGNMENT", "图片对齐值无效");
    if (
      attrs.width !== undefined &&
      (typeof attrs.width !== "number" || attrs.width < 10 || attrs.width > 100)
    )
      throw new HttpError(
        422,
        "INVALID_IMAGE_WIDTH",
        "图片宽度必须是 10-100 的百分比数值",
      );
  }
  if (node.type === "diceRoll") {
    stringAttr(attrs, "rollId", true);
    stringAttr(attrs, "expression", true);
    if (typeof attrs.total !== "number" || !Number.isFinite(attrs.total))
      throw new HttpError(422, "INVALID_DICE_TOTAL", "骰子必须保存有限 total");
    if (
      !Array.isArray(attrs.rolls) ||
      !attrs.rolls.every(
        (item) => typeof item === "number" && Number.isFinite(item),
      )
    )
      throw new HttpError(
        422,
        "INVALID_DICE_DETAILS",
        "骰子必须保存数值 rolls 明细",
      );
    if (
      attrs.rerollOf !== null &&
      attrs.rerollOf !== undefined &&
      typeof attrs.rerollOf !== "string"
    )
      throw new HttpError(
        422,
        "INVALID_DICE_REROLL",
        "rerollOf 必须是 rollId 或 null",
      );
  }
  if (node.type === "inlineCommentAnchor") {
    stringAttr(attrs, "threadId", true);
    if (!["start", "end"].includes(String(attrs.placement)))
      throw new HttpError(
        422,
        "INVALID_ANCHOR_POSITION",
        "间贴锚点只允许段落首或段落尾",
      );
    if (
      typeof attrs.count !== "number" ||
      !Number.isInteger(attrs.count) ||
      attrs.count < 0
    )
      throw new HttpError(
        422,
        "INVALID_ANCHOR_COUNT",
        "间贴 count 必须是非负整数",
      );
  }
  if (node.type === "novelExcerpt") {
    if (
      !["mobile-book", "desktop-book", "forum-evidence"].includes(
        String(attrs.variant),
      )
    )
      throw new HttpError(422, "INVALID_EXCERPT_VARIANT", "小说摘录样式无效");
    stringAttr(attrs, "bookTitle", true);
    stringAttr(attrs, "chapterTitle", true);
    stringAttr(attrs, "author", true);
    const sourceUrl = stringAttr(attrs, "sourceUrl");
    if (sourceUrl && !isHttpUrl(sourceUrl))
      throw new HttpError(422, "UNSAFE_URL", "摘录来源仅允许 HTTP(S)");
  }
  if (node.type === "mention") {
    stringAttr(attrs, "name", true);
    if (attrs.resolved !== undefined && typeof attrs.resolved !== "boolean")
      throw new HttpError(422, "INVALID_MENTION", "resolved 必须为布尔值");
    const avatarUrl = attrs.avatarUrl;
    if (
      avatarUrl !== null &&
      avatarUrl !== undefined &&
      (typeof avatarUrl !== "string" || !isHttpUrl(avatarUrl))
    )
      throw new HttpError(422, "UNSAFE_IMAGE_URL", "头像仅允许 HTTP(S)");
  }
  if (node.type === "replyGate") {
    stringAttr(attrs, "gateId", true);
    stringAttr(attrs, "prompt", true);
  }
  if (node.type === "attachmentRef") {
    stringAttr(attrs, "attachmentId", true);
    stringAttr(attrs, "name", true);
    stringAttr(attrs, "mimeType", true);
    if (
      typeof attrs.size !== "number" ||
      attrs.size < 0 ||
      typeof attrs.priceCoins !== "number" ||
      attrs.priceCoins < 0
    )
      throw new HttpError(
        422,
        "INVALID_ATTACHMENT",
        "附件大小和金币价格必须为非负数",
      );
  }
  if (node.type === "longTextBlock") {
    stringAttr(attrs, "chapterId", true);
    stringAttr(attrs, "title", true);
    stringAttr(attrs, "text", true, 50_000);
    if (
      typeof attrs.order !== "number" ||
      !Number.isInteger(attrs.order) ||
      attrs.order < 0
    )
      throw new HttpError(
        422,
        "INVALID_LONG_TEXT_ORDER",
        "长文本章节顺序必须是非负整数",
      );
    for (const key of ["start", "end"] as const) {
      const value = attrs[key];
      if (
        value !== null &&
        value !== undefined &&
        (typeof value !== "number" ||
          !Number.isInteger(value) ||
          value < 0)
      )
        throw new HttpError(
          422,
          "INVALID_LONG_TEXT_RANGE",
          "长文本章节原文区间必须是非负整数或 null",
        );
    }
  }
  if (node.type === "pollRef") {
    stringAttr(attrs, "pollId", true);
    stringAttr(attrs, "question", true);
    if (typeof attrs.multiple !== "boolean" || !Array.isArray(attrs.options))
      throw new HttpError(
        422,
        "INVALID_POLL",
        "投票 multiple/options 属性无效",
      );
  }
  for (const child of node.content ?? []) validateNode(child, depth + 1);
}

/** 对正文执行结构、节点、属性、协议、字体与颜色白名单校验。 */
export function sanitizeDocument(input: unknown): TiptapDocument {
  const parsed = TiptapDocumentSchema.safeParse(input);
  if (!parsed.success)
    throw new HttpError(422, "INVALID_DOCUMENT", "正文不是有效的 Tiptap JSON", {
      issue: parsed.error.issues[0]?.message ?? "未知结构错误",
    });
  for (const node of parsed.data.content) validateNode(node, 0);
  return parsed.data;
}

/** 在 Tiptap text 节点中仅替换第一次匹配，供审核建议合并。 */
export function replaceFirstText(
  content: TiptapDocument,
  fromText: string,
  toText: string,
): TiptapDocument | null {
  const cloned = structuredClone(content);
  let replaced = false;
  const visit = (node: TiptapNode): void => {
    if (!replaced && node.type === "text" && node.text?.includes(fromText)) {
      node.text = node.text.replace(fromText, toText);
      replaced = true;
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const node of cloned.content) visit(node);
  return replaced ? cloned : null;
}

/** 文档当前态、不可变修订、幂等写入与回滚服务。 */
export class DocumentService {
  readonly #db: DatabaseSync;

  /** 绑定 API 数据库。 */
  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** 读取当前修订。 */
  get(documentId: string): DocumentEnvelope {
    const document = this.#db
      .prepare(
        "SELECT id, title, schema_version, current_revision, updated_at FROM documents WHERE id = ?",
      )
      .get(documentId) as unknown as DocumentRow | undefined;
    if (!document) throw new HttpError(404, "DOCUMENT_NOT_FOUND", "文档不存在");
    return this.#envelope(document, document.current_revision);
  }

  /** 保存文档；created=false 表示命中 clientMutationId 幂等结果。 */
  save(
    documentId: string,
    request: UpdateDocumentRequest,
    authorId: string,
  ): { envelope: DocumentEnvelope; created: boolean } {
    const content = sanitizeDocument(request.content);
    const result = this.#write(
      documentId,
      request.baseRevision,
      request.clientMutationId,
      JSON.stringify(request),
      request.schemaVersion,
      content,
      authorId,
      "update",
      null,
    );
    // 每章独立版本：保存真正生效时，只递增本次编辑章节的 revision。
    if (result.created && request.chapterId) {
      this.#db
        .prepare("UPDATE chapters SET revision = revision + 1 WHERE id = ?")
        .run(request.chapterId);
    }
    return result;
  }

  /** 回滚到指定历史版本并创建新修订。 */
  rollback(
    documentId: string,
    request: RollbackDocumentRequest,
    authorId: string,
  ): { envelope: DocumentEnvelope; created: boolean } {
    const target = this.#db
      .prepare(
        "SELECT schema_version, content_json FROM document_revisions WHERE document_id = ? AND revision = ?",
      )
      .get(documentId, request.targetRevision) as
      { schema_version: number; content_json: string } | undefined;
    if (!target)
      throw new HttpError(404, "REVISION_NOT_FOUND", "目标修订不存在");
    const content = sanitizeDocument(JSON.parse(target.content_json));
    return this.#write(
      documentId,
      request.baseRevision,
      request.clientMutationId,
      JSON.stringify(request),
      target.schema_version,
      content,
      authorId,
      "rollback",
      request.targetRevision,
    );
  }

  /** 审核通过建议时创建真实修订。 */
  applySuggestion(
    documentId: string,
    baseRevision: number,
    suggestionId: string,
    content: TiptapDocument,
    authorId: string,
  ): DocumentEnvelope {
    return this.#write(
      documentId,
      baseRevision,
      `suggestion-${suggestionId}`,
      JSON.stringify({ baseRevision, suggestionId }),
      this.get(documentId).schemaVersion,
      sanitizeDocument(content),
      authorId,
      "suggestion",
      null,
    ).envelope;
  }

  /** 按 revision 倒序分页历史。 */
  revisions(
    documentId: string,
    cursor: string | undefined,
    limit: number,
  ): RevisionPage {
    this.get(documentId);
    const before =
      cursor === undefined ? Number.MAX_SAFE_INTEGER : Number(cursor);
    if (!Number.isSafeInteger(before) || before < 1)
      throw new HttpError(
        422,
        "INVALID_CURSOR",
        "版本 cursor 必须是正整数 revision",
      );
    const rows = this.#db
      .prepare(
        "SELECT r.revision, r.schema_version, r.author_id, u.name AS author_name, r.operation, r.target_revision, r.created_at FROM document_revisions r JOIN users u ON u.id = r.author_id WHERE r.document_id = ? AND r.revision < ? ORDER BY r.revision DESC LIMIT ?",
      )
      .all(documentId, before, limit + 1) as unknown as RevisionRow[];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => ({
        revision: row.revision,
        schemaVersion: row.schema_version,
        savedAt: row.created_at,
        authorId: row.author_id,
        authorName: row.author_name ?? row.author_id,
        operation: row.operation,
        summary: {
          seed: "创建初始版本",
          update: "保存正文修改",
          rollback: `回退到版本 ${row.target_revision ?? "?"}`,
          suggestion: "合并已审核纠错建议",
        }[row.operation],
        targetRevision: row.target_revision,
      })),
      pageInfo: { nextCursor: hasMore ? String(page.at(-1)!.revision) : null },
    };
  }

  #write(
    documentId: string,
    baseRevision: number,
    mutationId: string,
    requestJson: string,
    schemaVersion: number,
    content: TiptapDocument,
    authorId: string,
    operation: RevisionRow["operation"],
    targetRevision: number | null,
  ): { envelope: DocumentEnvelope; created: boolean } {
    // revision 检查、历史写入、幂等记录和当前指针更新必须处于同一写事务。
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const document = this.#db
        .prepare(
          "SELECT id, title, schema_version, current_revision, updated_at FROM documents WHERE id = ?",
        )
        .get(documentId) as unknown as DocumentRow | undefined;
      if (!document)
        throw new HttpError(404, "DOCUMENT_NOT_FOUND", "文档不存在");
      const existing = this.#db
        .prepare(
          "SELECT request_json, revision FROM document_mutations WHERE document_id = ? AND client_mutation_id = ?",
        )
        .get(documentId, mutationId) as
        { request_json: string; revision: number } | undefined;
      if (existing) {
        // 同 mutationId 只允许完全相同的请求重试，防止客户端误复用导致数据混淆。
        if (existing.request_json !== requestJson)
          throw new HttpError(
            409,
            "MUTATION_ID_REUSED",
            "clientMutationId 已被另一请求使用",
          );
        const envelope = this.#envelope(document, existing.revision);
        this.#db.exec("COMMIT");
        return { envelope, created: false };
      }
      if (document.current_revision !== baseRevision)
        throw new HttpError(409, "REVISION_CONFLICT", "文档已被其他修订更新", {
          currentRevision: document.current_revision,
          baseRevision,
        });
      const revision = document.current_revision + 1;
      const now = new Date().toISOString();
      this.#db
        .prepare(
          "INSERT INTO document_revisions(document_id, revision, schema_version, content_json, author_id, operation, target_revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          documentId,
          revision,
          schemaVersion,
          JSON.stringify(content),
          authorId,
          operation,
          targetRevision,
          now,
        );
      this.#db
        .prepare(
          "INSERT INTO document_mutations(document_id, client_mutation_id, request_json, revision) VALUES (?, ?, ?, ?)",
        )
        .run(documentId, mutationId, requestJson, revision);
      this.#db
        .prepare(
          "UPDATE documents SET schema_version = ?, current_revision = ?, updated_at = ? WHERE id = ?",
        )
        .run(schemaVersion, revision, now, documentId);
      this.#syncAnchors(documentId, content, now);
      document.schema_version = schemaVersion;
      document.current_revision = revision;
      document.updated_at = now;
      const envelope = this.#envelope(document, revision);
      this.#db.exec("COMMIT");
      return { envelope, created: true };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #syncAnchors(documentId: string, content: TiptapDocument, now: string): void {
    // 先归档再恢复当前正文中的锚点：删除正文标记不会级联删除已有讨论历史。
    const anchors = collectInlineCommentAnchorIds(content);
    this.#db
      .prepare("UPDATE comment_threads SET archived = 1 WHERE document_id = ?")
      .run(documentId);
    const upsert = this.#db.prepare(
      "INSERT INTO comment_threads(document_id, anchor_id, archived, created_at) VALUES (?, ?, 0, ?) ON CONFLICT(document_id, anchor_id) DO UPDATE SET archived = 0",
    );
    for (const anchorId of anchors) upsert.run(documentId, anchorId, now);
  }

  #envelope(document: DocumentRow, revision: number): DocumentEnvelope {
    // 响应从不可变 revision 重建；documents 表只保存当前指针和标题等元数据。
    const row = this.#db
      .prepare(
        "SELECT revision, schema_version, content_json, created_at FROM document_revisions WHERE document_id = ? AND revision = ?",
      )
      .get(document.id, revision) as unknown as RevisionRow | undefined;
    if (!row) throw new HttpError(500, "REVISION_MISSING", "文档当前修订缺失");
    return {
      id: document.id,
      title: document.title,
      schemaVersion: row.schema_version,
      revision: row.revision,
      savedAt: row.created_at,
      content: sanitizeDocument(JSON.parse(row.content_json)),
    };
  }
}
