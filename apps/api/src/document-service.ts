import type { DatabaseSync } from "node:sqlite";
import {
  TiptapDocumentSchema,
  collectInlineCommentAnchorIds,
  type DocumentEnvelope,
  type RevisionPage,
  type RollbackDocumentRequest,
  type TiptapDocument,
  type UpdateDocumentRequest,
  type UpdateDocumentStepsRequest,
} from "@ricetext/contracts";
import {
  ApplyStepsError,
  applyStepsToDocument,
  createDocumentSchema,
  describeStepsJson,
  splitDocumentByChapters,
  type JSONContent,
  type StepJson,
} from "@ricetext/document-core";
import {
  DomainError,
  repairDocumentForRead,
  sanitizeDocumentForWrite,
} from "@ricetext/server-core";
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
  steps_json: string | null;
  author_id: string;
  author_name?: string;
  operation: "seed" | "update" | "rollback" | "suggestion" | "steps";
  target_revision: number | null;
  created_at: string;
}

/** 对正文执行与 Worker 相同的严格白名单校验，并保留 Fastify HttpError 契约。 */
export function sanitizeDocument(input: unknown): TiptapDocument {
  try {
    return sanitizeDocumentForWrite(input);
  } catch (error) {
    if (error instanceof DomainError) {
      throw new HttpError(error.status, error.code, error.message, error.details);
    }
    throw error;
  }
}

/** 读取时宽容修复持久化数据，保证交付内容始终处于白名单内。 */
function repairDocument(input: unknown): TiptapDocument {
  return repairDocumentForRead(input);
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

  /** 读取指定不可变历史修订。 */
  revision(documentId: string, revision: number): DocumentEnvelope {
    const document = this.#db
      .prepare(
        "SELECT id, title, schema_version, current_revision, updated_at FROM documents WHERE id = ?",
      )
      .get(documentId) as unknown as DocumentRow | undefined;
    if (!document) throw new HttpError(404, "DOCUMENT_NOT_FOUND", "文档不存在");
    const exists = this.#db
      .prepare(
        "SELECT 1 AS found FROM document_revisions WHERE document_id = ? AND revision = ?",
      )
      .get(documentId, revision) as { found: number } | undefined;
    if (!exists) throw new HttpError(404, "REVISION_NOT_FOUND", "目标版本不存在");
    return this.#envelope(document, revision);
  }

  /** 保存文档；created=false 表示命中 clientMutationId 幂等结果。 */
  save(
    documentId: string,
    request: UpdateDocumentRequest,
    authorId: string,
  ): { envelope: DocumentEnvelope; created: boolean } {
    const content = sanitizeDocument(request.content);
    return this.#write(
      documentId,
      request.baseRevision,
      request.clientMutationId,
      JSON.stringify(request),
      request.schemaVersion,
      content,
      authorId,
      "update",
      null,
      null,
      { ...(request.chapterId ? { chapterId: request.chapterId } : {}) },
    );
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

  /**
   * 在服务端完整运行 ProseMirror：把客户端提交的最小 transaction steps
   * 应用到当前 revision 的快照，生成新修订（快照 + steps 双记录）。
   */
  applySteps(
    documentId: string,
    request: UpdateDocumentStepsRequest,
    authorId: string,
  ): { envelope: DocumentEnvelope; created: boolean } {
    const current = this.get(documentId);
    let content: TiptapDocument;
    try {
      const next = applyStepsToDocument(
        createDocumentSchema(),
        current.content as unknown as JSONContent,
        request.steps as unknown as StepJson[],
      );
      content = sanitizeDocument(next);
    } catch (error) {
      if (error instanceof ApplyStepsError)
        throw new HttpError(422, "INVALID_STEPS", error.message);
      throw error;
    }
    return this.#write(
      documentId,
      request.baseRevision,
      request.clientMutationId,
      JSON.stringify(request),
      request.schemaVersion,
      content,
      authorId,
      "steps",
      null,
      JSON.stringify(request.steps),
      { ...(request.chapterId ? { chapterId: request.chapterId } : {}) },
    );
  }

  /** 审核通过建议时创建真实修订。 */
  applySuggestion(
    documentId: string,
    baseRevision: number,
    suggestionId: string,
    content: TiptapDocument,
    authorId: string,
    options: { chapterId?: string; beforeCommit?: (createdAt: string) => void } = {},
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
      null,
      options,
    ).envelope;
  }

  /** 在不写入的情况下验证读者批量校订 steps 可应用于指定基线。 */
  validateSuggestionSteps(
    documentId: string,
    baseRevision: number,
    steps: Array<Record<string, unknown>>,
  ): TiptapDocument {
    const current = this.get(documentId);
    if (current.revision !== baseRevision)
      throw new HttpError(409, "REVISION_CONFLICT", "正文已变化，请重新编辑后提交", {
        currentRevision: current.revision,
        baseRevision,
      });
    try {
      return sanitizeDocument(
        applyStepsToDocument(
          createDocumentSchema(),
          current.content as unknown as JSONContent,
          steps as unknown as StepJson[],
        ),
      );
    } catch (error) {
      if (error instanceof ApplyStepsError)
        throw new HttpError(422, "INVALID_STEPS", error.message);
      throw error;
    }
  }

  /** 接受整章批量校订：一次应用全部 steps，并只创建一个 suggestion revision。 */
  applySuggestionBatch(
    documentId: string,
    baseRevision: number,
    batchId: string,
    steps: Array<Record<string, unknown>>,
    chapterId: string,
    authorId: string,
    beforeCommit?: (createdAt: string) => void,
  ): DocumentEnvelope {
    const current = this.get(documentId);
    let content: TiptapDocument;
    try {
      content = sanitizeDocument(
        applyStepsToDocument(
          createDocumentSchema(),
          current.content as unknown as JSONContent,
          steps as unknown as StepJson[],
        ),
      );
    } catch (error) {
      if (error instanceof ApplyStepsError)
        throw new HttpError(422, "INVALID_STEPS", error.message);
      throw error;
    }
    return this.#write(
      documentId,
      baseRevision,
      `suggestion-batch-${batchId}`,
      JSON.stringify({ baseRevision, batchId, chapterId, steps }),
      current.schemaVersion,
      content,
      authorId,
      "suggestion",
      null,
      JSON.stringify(steps),
      { chapterId, ...(beforeCommit ? { beforeCommit } : {}) },
    ).envelope;
  }

  /** 按 revision 倒序分页历史。 */
  revisions(
    documentId: string,
    cursor: string | undefined,
    limit: number,
    chapterId?: string,
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
        "SELECT r.revision, r.schema_version, r.content_json, r.author_id, u.name AS author_name, r.operation, r.target_revision, r.steps_json, r.created_at FROM document_revisions r JOIN users u ON u.id = r.author_id WHERE r.document_id = ? AND r.revision < ? ORDER BY r.revision DESC",
      )
      .all(documentId, before) as unknown as RevisionRow[];
    let matchingRows = rows;
    if (chapterId) {
      const chapter = this.#db
        .prepare(
          "SELECT sort_order FROM chapters WHERE document_id = ? AND id = ?",
        )
        .get(documentId, chapterId) as { sort_order: number } | undefined;
      if (!chapter)
        throw new HttpError(404, "CHAPTER_NOT_FOUND", "章节不存在");
      const snapshot = (contentJson: string | undefined) => {
        if (!contentJson) return null;
        const content = TiptapDocumentSchema.parse(JSON.parse(contentJson));
        // 章节在该修订中尚不存在时返回 null（而非 JSON 字符串 "null"）：
        // 才能把「章尚未创建」与「空章节」区分开，避免把整篇种子版本
        // 误归入后来才创建的新章节历史。
        const section = splitDocumentByChapters(content as JSONContent).chapters[
          chapter.sort_order
        ];
        return section ? JSON.stringify(section.blocks) : null;
      };
      matchingRows = rows.filter((row) => {
        const mutation = this.#db
          .prepare(
            "SELECT request_json FROM document_mutations WHERE document_id = ? AND revision = ? LIMIT 1",
          )
          .get(documentId, row.revision) as
          | { request_json: string }
          | undefined;
        if (mutation) {
          const request = JSON.parse(mutation.request_json) as {
            chapterId?: unknown;
          };
          if (typeof request.chapterId === "string")
            return request.chapterId === chapterId;
        }
        // 无 chapterId 的修订（种子、回滚、建议合并等）只把「种子基线」归入：
        // 该章在整篇种子文档中已存在时，修订 1 是它的创建基线；不再采用
        // 「相邻修订内容差异」折叠——章节位置错位（插入/删除/改名）时会把
        // 其他章节的旧修订误算给新建章节（新建章节只点一次保存不该出现若干条无关历史）。
        return (
          row.operation === "seed" && snapshot(row.content_json) !== null
        );
      });
    }
    const hasMore = matchingRows.length > limit;
    const page = matchingRows.slice(0, limit);
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
          steps: "应用增量编辑",
        }[row.operation],
        stepsSummary: row.steps_json
          ? describeStepsJson(JSON.parse(row.steps_json) as StepJson[])
          : null,
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
    stepsJson: string | null = null,
    options: { chapterId?: string; beforeCommit?: (createdAt: string) => void } = {},
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
          "INSERT INTO document_revisions(document_id, revision, schema_version, content_json, steps_json, author_id, operation, target_revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          documentId,
          revision,
          schemaVersion,
          JSON.stringify(content),
          stepsJson,
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
      if (options.chapterId) {
        const chapter = this.#db
          .prepare(
            "UPDATE chapters SET revision = revision + 1, updated_at = ? " +
              "WHERE id = ? AND document_id = ?",
          )
          .run(now, options.chapterId, documentId);
        if (chapter.changes !== 1) {
          throw new HttpError(404, "CHAPTER_NOT_FOUND", "章节不存在或不属于当前文档");
        }
      }
      options.beforeCommit?.(now);
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
      // 读取一律交付清洗后的重建文档（宽容修复），不因单个问题整篇 422。
      content: repairDocument(JSON.parse(row.content_json)),
    };
  }
}
