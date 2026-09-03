import {
  convertLongTextBlocksToChapters,
  type JSONContent,
} from "@ricetext/document-core";
import {
  ChapterContentSchema,
  ChapterSchema,
  type Chapter,
  type ChapterContent,
  type TiptapDocument,
} from "@ricetext/contracts";
import { chapterStorageId, sanitizeDocumentForWrite } from "@ricetext/server-core";
import { WorkerHttpError } from "../http-error";

type ChapterRow = {
  id: string;
  title: string;
  sort_order: number;
  document_id: string;
  revision: number;
  updated_at: string;
  hidden: number;
};

type ChapterRevisionRow = {
  revision: number;
};

function chapter(row: ChapterRow): Chapter {
  return ChapterSchema.parse({
    id: row.id,
    title: row.title,
    order: row.sort_order,
    documentId: row.document_id,
    revision: row.revision,
    savedAt: row.updated_at,
    hidden: row.hidden === 1,
  });
}

/** 章节目录仓储；所有写入同时校验 document_id，禁止跨文档复用章节 ID。 */
export class D1ChapterRepository {
  constructor(private readonly db: D1Database) {}

  private async requireDocument(documentId: string): Promise<void> {
    const found = await this.db
      .prepare("SELECT 1 AS found FROM documents WHERE id = ?")
      .bind(documentId)
      .first<{ found: number }>();
    if (!found) throw new WorkerHttpError(404, "DOCUMENT_NOT_FOUND", "文档不存在");
  }

  private async row(documentId: string, chapterId: string): Promise<ChapterRow | null> {
    return this.db
      .prepare(
        "SELECT id, title, sort_order, document_id, revision, updated_at, hidden " +
          "FROM chapters WHERE id = ? AND document_id = ?",
      )
      .bind(chapterId, documentId)
      .first<ChapterRow>();
  }

  async content(documentId: string, chapterId: string): Promise<ChapterContent> {
    const row = await this.db
      .prepare(
        "SELECT id, title, sort_order, document_id, revision, updated_at, hidden, content_json " +
          "FROM chapters WHERE id = ? AND document_id = ?",
      )
      .bind(chapterId, documentId)
      .first<ChapterRow & { content_json: string | null }>();
    if (!row?.content_json)
      throw new WorkerHttpError(404, "CHAPTER_NOT_FOUND", "章节正文不存在");
    return ChapterContentSchema.parse({
      ...chapter(row),
      content: convertLongTextBlocksToChapters(JSON.parse(row.content_json)),
    });
  }

  async create(
    documentId: string,
    input: { title: string; order: number },
  ): Promise<{ value: Chapter; created: boolean }> {
    await this.requireDocument(documentId);
    const chapterId = chapterStorageId(documentId, input.order);
    const now = new Date().toISOString();
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            "INSERT OR IGNORE INTO chapters(" +
              "id, title, sort_order, document_id, revision, updated_at, hidden" +
              ") VALUES (?, ?, ?, ?, 0, ?, 0)",
          )
          .bind(chapterId, input.title, input.order, documentId, now),
        this.db
          .prepare(
            "UPDATE chapters SET title = ?, sort_order = ? " +
              "WHERE id = ? AND document_id = ?",
          )
          .bind(input.title, input.order, chapterId, documentId),
      ]);
      const stored = await this.row(documentId, chapterId);
      if (!stored) {
        throw new WorkerHttpError(
          409,
          "CHAPTER_ORDER_CONFLICT",
          "该章节位置已被其他章节占用",
        );
      }
      return { value: chapter(stored), created: results[0]!.meta.changes > 0 };
    } catch (error) {
      if (error instanceof WorkerHttpError) throw error;
      const stored = await this.row(documentId, chapterId);
      if (stored) return { value: chapter(stored), created: false };
      throw new WorkerHttpError(
        409,
        "CHAPTER_ORDER_CONFLICT",
        "该章节位置已被其他章节占用",
      );
    }
  }

  async updateHidden(
    documentId: string,
    chapterId: string,
    hidden: boolean,
  ): Promise<Chapter> {
    await this.requireDocument(documentId);
    const result = await this.db
      .prepare("UPDATE chapters SET hidden = ? WHERE id = ? AND document_id = ?")
      .bind(hidden ? 1 : 0, chapterId, documentId)
      .run();
    if (result.meta.changes === 0) {
      throw new WorkerHttpError(404, "CHAPTER_NOT_FOUND", "章节目录中不存在该章节");
    }
    return chapter((await this.row(documentId, chapterId))!);
  }

  async delete(
    documentId: string,
    chapterId: string,
  ): Promise<{ id: string; deleted: boolean }> {
    await this.requireDocument(documentId);
    const results = await this.db.batch([
      this.db
        .prepare("UPDATE suggestions SET chapter_id = NULL WHERE chapter_id = ?")
        .bind(chapterId),
      this.db
        .prepare("DELETE FROM chapters WHERE id = ? AND document_id = ?")
        .bind(chapterId, documentId),
    ]);
    return { id: chapterId, deleted: results[1]!.meta.changes > 0 };
  }

  async syncHashes(
    documentId: string,
    local: readonly { id: string; hash: string }[],
  ): Promise<{ toUpdate: string[]; existing: string[] }> {
    await this.requireDocument(documentId);
    const result = await this.db
      .prepare("SELECT id, content_hash FROM chapters WHERE document_id = ?")
      .bind(documentId)
      .all<{ id: string; content_hash: string | null }>();
    const hashes = new Map(result.results.map((row) => [row.id, row.content_hash]));
    return {
      toUpdate: local.filter((item) => hashes.get(item.id) !== item.hash).map((item) => item.id),
      existing: [...hashes.keys()],
    };
  }

  async save(
    documentId: string,
    chapterId: string,
    input: {
      title: string;
      order: number;
      content: TiptapDocument;
      hash: string;
      baseRevision: number;
    },
  ): Promise<{ id: string; title: string; order: number; revision: number }> {
    await this.requireDocument(documentId);
    const owner = await this.db
      .prepare("SELECT document_id FROM chapters WHERE id = ?")
      .bind(chapterId)
      .first<{ document_id: string }>();
    if (owner && owner.document_id !== documentId) {
      throw new WorkerHttpError(409, "CHAPTER_ID_CONFLICT", "章节 ID 已属于另一篇文档");
    }
    const content = sanitizeDocumentForWrite(
      convertLongTextBlocksToChapters(input.content as unknown as JSONContent),
    );
    const revision = input.baseRevision + 1;
    const now = new Date().toISOString();
    try {
      const row = await this.db
        .prepare(
          "INSERT INTO chapters(" +
            "id, title, sort_order, document_id, revision, content_json, content_hash, updated_at, hidden" +
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0) " +
            "ON CONFLICT(id) DO UPDATE SET " +
            "title = excluded.title, sort_order = excluded.sort_order, " +
            "revision = excluded.revision, content_json = excluded.content_json, " +
            "content_hash = excluded.content_hash, updated_at = excluded.updated_at " +
            "WHERE chapters.document_id = excluded.document_id AND chapters.revision = ? " +
            "RETURNING id, title, sort_order, revision",
        )
        .bind(
          chapterId,
          input.title,
          input.order,
          documentId,
          revision,
          JSON.stringify(content),
          input.hash,
          now,
          input.baseRevision,
        )
        .first<{ id: string; title: string; sort_order: number; revision: number }>();
      if (row) {
        return { id: row.id, title: row.title, order: row.sort_order, revision: row.revision };
      }
    } catch {
      const current = await this.db
        .prepare("SELECT revision FROM chapters WHERE id = ? AND document_id = ?")
        .bind(chapterId, documentId)
        .first<ChapterRevisionRow>();
      if (current && current.revision !== input.baseRevision) {
        throw new WorkerHttpError(
          409,
          "CHAPTER_REVISION_CONFLICT",
          "章节已被其他修改更新，请重新对比差异",
          { currentRevision: current.revision, baseRevision: input.baseRevision },
        );
      }
      throw new WorkerHttpError(
        409,
        "CHAPTER_ORDER_CONFLICT",
        "该章节位置已被其他章节占用",
      );
    }

    const current = await this.db
      .prepare("SELECT revision FROM chapters WHERE id = ? AND document_id = ?")
      .bind(chapterId, documentId)
      .first<ChapterRevisionRow>();
    throw new WorkerHttpError(
      409,
      "CHAPTER_REVISION_CONFLICT",
      "章节已被其他修改更新，请重新对比差异",
      {
        currentRevision: current?.revision ?? 0,
        baseRevision: input.baseRevision,
      },
    );
  }

  private async metadata(
    ids: readonly string[],
  ): Promise<Array<{
    id: string;
    document_id: string;
    revision: number;
    sort_order: number;
    content_hash: string | null;
  }>> {
    const placeholders = ids.map(() => "?").join(", ");
    const result = await this.db
      .prepare(
        "SELECT id, document_id, revision, sort_order, content_hash FROM chapters " +
          "WHERE id IN (" + placeholders + ")",
      )
      .bind(...ids)
      .all<{
        id: string;
        document_id: string;
        revision: number;
        sort_order: number;
        content_hash: string | null;
      }>();
    return result.results;
  }

  private async documentOrders(
    documentId: string,
  ): Promise<Array<{ id: string; sort_order: number }>> {
    const result = await this.db
      .prepare("SELECT id, sort_order FROM chapters WHERE document_id = ?")
      .bind(documentId)
      .all<{ id: string; sort_order: number }>();
    return result.results;
  }

  /**
   * 批量保存章节正文（每批最多 20 章；D1 查询预算：文档校验 1 + 元数据
   * 1 + 目标 order 占用 1 + 最多 20 条 UPSERT = 23，低于 Free 50 上限）。
   *
   * 与单章 save 相同的语义：先整批预校验（跨文章 ID、order 冲突、
   * baseRevision 过期），任一失败整批 409 且正文不发生部分提交；
   * content_hash 已一致时返回 unchanged 与当前 revision（响应丢失后的
   * 重试不会再次递增版本）。
   *
   * 预校验与写入之间存在并发写窗口，因此每条 UPSERT 都带
   * `chapters.revision = baseRevision` 守卫；窗口期内被并发修改时改动
   * 数为 0，随后重读该行区分「已提交同内容（幂等）→ unchanged」与
   * 「他人先行修改 → 409」，绝不静默覆盖。
   */
  async saveBatch(
    documentId: string,
    items: Array<{
      id: string;
      title: string;
      order: number;
      content: TiptapDocument;
      hash: string;
      baseRevision: number;
    }>,
  ): Promise<Array<{
    id: string;
    title: string;
    order: number;
    revision: number;
    status: "saved" | "unchanged";
  }>> {
    await this.requireDocument(documentId);
    const byId = new Map(
      (await this.metadata(items.map((item) => item.id))).map((row) => [
        row.id,
        row,
      ]),
    );
    const docOrders = await this.documentOrders(documentId);
    const results: Array<{
      id: string;
      title: string;
      order: number;
      revision: number;
      status: "saved" | "unchanged";
    }> = [];
    const write: Array<{
      id: string;
      title: string;
      order: number;
      content: TiptapDocument;
      hash: string;
      revision: number;
      baseRevision: number;
    }> = [];
    const seenOrders = new Set<number>();
    // 目标顺序被「其他服务器行」占用时不再整批 409：同一个 D1 batch（事务）
    // 里先把它搬出目标顺序（搬到比本批所有请求顺序更高的空闲位，内容保留、
    // 顺序变化递增版本），再写入新章——新文件上传模型下这类占用行基本是
    // 历史残留或占位行。
    const moves: Array<{ id: string; to: number }> = [];
    let nextFree =
      Math.max(
        -1,
        ...docOrders.map((row) => row.sort_order),
        ...items.map((item) => item.order),
      ) + 1;
    const now = new Date().toISOString();
    for (const item of items) {
      const existing = byId.get(item.id);
      if (existing && existing.document_id !== documentId) {
        throw new WorkerHttpError(
          409,
          "CHAPTER_ID_CONFLICT",
          "章节 ID 已属于另一篇文档",
          { chapterId: item.id },
        );
      }
      if (seenOrders.has(item.order)) {
        throw new WorkerHttpError(
          409,
          "CHAPTER_ORDER_CONFLICT",
          "批次内多个章节请求相同目标顺序",
          { chapterId: item.id },
        );
      }
      seenOrders.add(item.order);
      const occupied = docOrders.find(
        (row) => row.sort_order === item.order && row.id !== item.id,
      );
      if (occupied) {
        moves.push({ id: occupied.id, to: nextFree });
        nextFree += 1;
      }
      if (existing) {
        if (existing.content_hash === item.hash) {
          results.push({
            id: item.id,
            title: item.title,
            order: item.order,
            revision: existing.revision,
            status: "unchanged",
          });
          continue;
        }
        if (existing.revision !== item.baseRevision) {
          throw new WorkerHttpError(
            409,
            "CHAPTER_REVISION_CONFLICT",
            "章节已被其他修改更新，请重新对比差异",
            { chapterId: item.id, currentRevision: existing.revision },
          );
        }
      }
      const content = sanitizeDocumentForWrite(
        convertLongTextBlocksToChapters(
          item.content as unknown as JSONContent,
        ),
      );
      write.push({
        id: item.id,
        title: item.title,
        order: item.order,
        content,
        hash: item.hash,
        revision: (existing?.revision ?? 0) + 1,
        baseRevision: item.baseRevision,
      });
    }
    // 占用行搬移与章节写入合并进同一个事务批：要么全部生效要么全部回滚。
    const statements = [
      ...moves.map((move) =>
        this.db
          .prepare(
            "UPDATE chapters SET sort_order = ?, revision = revision + 1, updated_at = ? " +
              "WHERE id = ? AND document_id = ?",
          )
          .bind(move.to, now, move.id, documentId),
      ),
      ...write.map((item) =>
        this.db
          .prepare(
            "INSERT INTO chapters(" +
              "id, title, sort_order, document_id, revision, content_json, content_hash, updated_at, hidden" +
              ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0) " +
              "ON CONFLICT(id) DO UPDATE SET " +
              "title = excluded.title, sort_order = excluded.sort_order, " +
              "revision = excluded.revision, content_json = excluded.content_json, " +
              "content_hash = excluded.content_hash, updated_at = excluded.updated_at " +
              "WHERE chapters.document_id = excluded.document_id AND chapters.revision = ?",
          )
          .bind(
            item.id,
            item.title,
            item.order,
            documentId,
            item.revision,
            JSON.stringify(item.content),
            item.hash,
            now,
            item.baseRevision,
          ),
      ),
    ];
    let executed: Array<{ meta: { changes: number } }> = [];
    if (statements.length > 0) {
      try {
        executed = (await this.db.batch(statements)) as unknown as Array<{
          meta: { changes: number };
        }>;
      } catch (error) {
        throw await this.resolveBatchConflict(documentId, items, error);
      }
    }
    for (const [index, item] of write.entries()) {
      // 语句数组开头是占用行搬移，章节写入从 moves.length 开始。
      const changed =
        executed[moves.length + index] === undefined ||
        executed[moves.length + index]!.meta.changes > 0;
      if (changed) {
        results.push({
          id: item.id,
          title: item.title,
          order: item.order,
          revision: item.revision,
          status: "saved",
        });
        continue;
      }
      const current = await this.metadata([item.id]);
      const row = current[0];
      if (row && row.document_id !== documentId) {
        throw new WorkerHttpError(
          409,
          "CHAPTER_ID_CONFLICT",
          "章节 ID 已属于另一篇文档",
          { chapterId: item.id },
        );
      }
      if (row && row.content_hash === item.hash) {
        results.push({
          id: item.id,
          title: item.title,
          order: item.order,
          revision: row.revision,
          status: "unchanged",
        });
        continue;
      }
      throw new WorkerHttpError(
        409,
        "CHAPTER_REVISION_CONFLICT",
        "章节已被其他修改更新，请重新对比差异",
        {
          chapterId: item.id,
          currentRevision: row?.revision ?? 0,
          baseRevision: item.baseRevision,
        },
      );
    }
    return results;
  }

  /**
   * 换序暂存（每批最多 40 项；D1 查询预算：文档校验 1 + 元数据 1 +
   * 目标 order 占用 1 + 最多 40 条 UPDATE = 43，低于 Free 50 上限）。
   *
   * 幂等语义与 Node 实现一致：当前顺序已等于临时顺序时不重复递增
   * revision；响应丢失后的重试返回当前 revision；顺序冲突或版本过期
   * 整批 409。每条 UPDATE 带 revision 守卫，并发窗口内被修改时改动数
   * 为 0，随后重读该行区分「已暂存（幂等）→ staged」与「他人先行修改
   * → 409」。
   */
  async stageReorder(
    documentId: string,
    items: Array<{ id: string; temporaryOrder: number; baseRevision: number }>,
  ): Promise<
    Array<{ id: string; revision: number; status: "staged" | "unchanged" }>
  > {
    await this.requireDocument(documentId);
    const byId = new Map(
      (await this.metadata(items.map((item) => item.id))).map((row) => [
        row.id,
        row,
      ]),
    );
    const docOrders = await this.documentOrders(documentId);
    const results: Array<{
      id: string;
      revision: number;
      status: "staged" | "unchanged";
    }> = [];
    const staged: Array<{
      id: string;
      temporaryOrder: number;
      baseRevision: number;
      revision: number;
    }> = [];
    const seenOrders = new Set<number>();
    const now = new Date().toISOString();
    for (const item of items) {
      const existing = byId.get(item.id);
      if (existing && existing.document_id !== documentId) {
        throw new WorkerHttpError(
          409,
          "CHAPTER_ID_CONFLICT",
          "章节 ID 已属于另一篇文档",
          { chapterId: item.id },
        );
      }
      if (seenOrders.has(item.temporaryOrder)) {
        throw new WorkerHttpError(
          409,
          "CHAPTER_ORDER_CONFLICT",
          "批次内多个章节请求相同临时顺序",
          { chapterId: item.id },
        );
      }
      seenOrders.add(item.temporaryOrder);
      const occupied = docOrders.find(
        (row) => row.sort_order === item.temporaryOrder && row.id !== item.id,
      );
      if (occupied) {
        throw new WorkerHttpError(
          409,
          "CHAPTER_ORDER_CONFLICT",
          "该临时顺序已被其他章节占用",
          { chapterId: item.id },
        );
      }
      if (!existing) {
        throw new WorkerHttpError(
          404,
          "CHAPTER_NOT_FOUND",
          "章节目录中不存在该章节",
          { chapterId: item.id },
        );
      }
      if (existing.sort_order === item.temporaryOrder) {
        if (
          existing.revision === item.baseRevision ||
          existing.revision === item.baseRevision + 1
        ) {
          results.push({
            id: item.id,
            revision: existing.revision,
            status:
              existing.revision === item.baseRevision ? "unchanged" : "staged",
          });
          continue;
        }
        throw new WorkerHttpError(
          409,
          "CHAPTER_REVISION_CONFLICT",
          "章节已被其他修改更新，请重新对比差异",
          { chapterId: item.id, currentRevision: existing.revision },
        );
      }
      if (existing.revision !== item.baseRevision) {
        throw new WorkerHttpError(
          409,
          "CHAPTER_REVISION_CONFLICT",
          "章节已被其他修改更新，请重新对比差异",
          { chapterId: item.id, currentRevision: existing.revision },
        );
      }
      staged.push({
        id: item.id,
        temporaryOrder: item.temporaryOrder,
        baseRevision: item.baseRevision,
        revision: item.baseRevision + 1,
      });
    }
    let executed: Array<{ meta: { changes: number } }> = [];
    if (staged.length > 0) {
      try {
        executed = (await this.db.batch(
          staged.map((item) =>
            this.db
              .prepare(
                "UPDATE chapters SET sort_order = ?, revision = ?, updated_at = ? " +
                  "WHERE id = ? AND document_id = ? AND revision = ?",
              )
              .bind(
                item.temporaryOrder,
                item.revision,
                now,
                item.id,
                documentId,
                item.baseRevision,
              ),
          ),
        )) as unknown as Array<{ meta: { changes: number } }>;
      } catch (error) {
        throw await this.resolveReorderConflict(documentId, items, error);
      }
    }
    for (const [index, item] of staged.entries()) {
      const changed =
        executed[index] === undefined || executed[index]!.meta.changes > 0;
      if (changed) {
        results.push({ id: item.id, revision: item.revision, status: "staged" });
        continue;
      }
      const current = await this.metadata([item.id]);
      const row = current[0];
      if (row && row.sort_order === item.temporaryOrder) {
        results.push({ id: item.id, revision: row.revision, status: "staged" });
        continue;
      }
      throw new WorkerHttpError(
        409,
        "CHAPTER_REVISION_CONFLICT",
        "章节已被其他修改更新，请重新对比差异",
        {
          chapterId: item.id,
          currentRevision: row?.revision ?? 0,
          baseRevision: item.baseRevision,
        },
      );
    }
    return results;
  }

  /** 批量写入约束失败后重读行状态，把并发竞争映射为带 chapterId 的 409。 */
  private async resolveBatchConflict(
    documentId: string,
    items: Array<{
      id: string;
      order: number;
      hash: string;
      baseRevision: number;
    }>,
    error: unknown,
  ): Promise<WorkerHttpError> {
    const byId = new Map(
      (await this.metadata(items.map((item) => item.id))).map((row) => [
        row.id,
        row,
      ]),
    );
    const docOrders = await this.documentOrders(documentId);
    for (const item of items) {
      const existing = byId.get(item.id);
      if (existing && existing.document_id !== documentId) {
        return new WorkerHttpError(
          409,
          "CHAPTER_ID_CONFLICT",
          "章节 ID 已属于另一篇文档",
          { chapterId: item.id },
        );
      }
      const occupied = docOrders.find(
        (row) => row.sort_order === item.order && row.id !== item.id,
      );
      if (occupied) {
        return new WorkerHttpError(
          409,
          "CHAPTER_ORDER_CONFLICT",
          "该章节位置已被其他章节占用",
          { chapterId: item.id },
        );
      }
      if (existing && existing.revision !== item.baseRevision) {
        return new WorkerHttpError(
          409,
          "CHAPTER_REVISION_CONFLICT",
          "章节已被其他修改更新，请重新对比差异",
          { chapterId: item.id, currentRevision: existing.revision },
        );
      }
    }
    return new WorkerHttpError(
      409,
      "CHAPTER_ORDER_CONFLICT",
      "保存批次时发生并发冲突",
      { detail: error instanceof Error ? error.message : String(error) },
    );
  }

  /** 换序暂存失败后重读行状态，把并发竞争映射为带 chapterId 的 409。 */
  private async resolveReorderConflict(
    documentId: string,
    items: Array<{ id: string; temporaryOrder: number; baseRevision: number }>,
    error: unknown,
  ): Promise<WorkerHttpError> {
    const byId = new Map(
      (await this.metadata(items.map((item) => item.id))).map((row) => [
        row.id,
        row,
      ]),
    );
    const docOrders = await this.documentOrders(documentId);
    for (const item of items) {
      const existing = byId.get(item.id);
      if (existing && existing.document_id !== documentId) {
        return new WorkerHttpError(
          409,
          "CHAPTER_ID_CONFLICT",
          "章节 ID 已属于另一篇文档",
          { chapterId: item.id },
        );
      }
      const occupied = docOrders.find(
        (row) => row.sort_order === item.temporaryOrder && row.id !== item.id,
      );
      if (occupied) {
        return new WorkerHttpError(
          409,
          "CHAPTER_ORDER_CONFLICT",
          "该临时顺序已被其他章节占用",
          { chapterId: item.id },
        );
      }
      if (existing && existing.revision !== item.baseRevision) {
        return new WorkerHttpError(
          409,
          "CHAPTER_REVISION_CONFLICT",
          "章节已被其他修改更新，请重新对比差异",
          { chapterId: item.id, currentRevision: existing.revision },
        );
      }
    }
    return new WorkerHttpError(
      409,
      "CHAPTER_ORDER_CONFLICT",
      "换序暂存时发生并发冲突",
      { detail: error instanceof Error ? error.message : String(error) },
    );
  }

}
