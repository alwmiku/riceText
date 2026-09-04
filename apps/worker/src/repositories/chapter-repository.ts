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
import { chapterStorageId, sanitizeDocumentForWrite, sha256Hex } from "@ricetext/server-core";
import { WorkerHttpError } from "../http-error";

type ChapterRow = {
  id: string;
  title: string;
  volume_title: string;
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
    volumeTitle: row.volume_title,
    order: row.sort_order,
    documentId: row.document_id,
    revision: row.revision,
    savedAt: row.updated_at,
    hidden: row.hidden === 1,
  });
}

/** 章节目录仓储；文章 ID 与章节 ID 共同确定唯一章节。 */
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
        "SELECT id, title, volume_title, sort_order, document_id, revision, updated_at, hidden " +
          "FROM chapters WHERE id = ? AND document_id = ?",
      )
      .bind(chapterId, documentId)
      .first<ChapterRow>();
  }

  async content(documentId: string, chapterId: string): Promise<ChapterContent> {
    const row = await this.db
      .prepare(
        "SELECT id, title, volume_title, sort_order, document_id, revision, updated_at, hidden, content_json " +
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
    const existing = await this.row(documentId, chapterId);
    if (!existing) return { id: chapterId, deleted: false };
    const now = new Date().toISOString();
    const results = await this.db.batch([
      this.db
        .prepare(
          "UPDATE suggestions SET chapter_id = NULL " +
            "WHERE document_id = ? AND chapter_id = ?",
        )
        .bind(documentId, chapterId),
      this.db
        .prepare("DELETE FROM chapters WHERE id = ? AND document_id = ?")
        .bind(chapterId, documentId),
      this.db
        .prepare(
          "UPDATE chapters SET sort_order = -sort_order - 1 " +
            "WHERE document_id = ? AND sort_order > ?",
        )
        .bind(documentId, existing.sort_order),
      this.db
        .prepare(
          "UPDATE chapters SET sort_order = -sort_order - 2, " +
            "revision = revision + 1, updated_at = ? " +
            "WHERE document_id = ? AND sort_order < ?",
        )
        .bind(now, documentId, -existing.sort_order - 1),
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
            "ON CONFLICT(document_id, id) DO UPDATE SET " +
            "title = excluded.title, sort_order = excluded.sort_order, " +
            "revision = excluded.revision, content_json = excluded.content_json, " +
            "content_hash = excluded.content_hash, updated_at = excluded.updated_at " +
            "WHERE chapters.revision = ? " +
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

  async createUpload(documentId: string, manifestHash: string, totalChapters: number) {
    await this.requireDocument(documentId);
    let existing = await this.db
      .prepare("SELECT id FROM chapter_uploads WHERE document_id=? AND manifest_hash=? AND status='uploading' ORDER BY created_at DESC LIMIT 1")
      .bind(documentId, manifestHash)
      .first<{ id: string }>();
    if (!existing) {
      const recoverable = await this.db
        .prepare("SELECT id FROM chapter_uploads WHERE document_id=? AND manifest_hash=? AND status='aborted' ORDER BY created_at DESC LIMIT 1")
        .bind(documentId, manifestHash)
        .first<{ id: string }>();
      if (recoverable) {
        const reopened = await this.db
          .prepare("UPDATE chapter_uploads SET status='uploading' WHERE document_id=? AND id=? AND status='aborted'")
          .bind(documentId, recoverable.id)
          .run();
        if (reopened.meta.changes === 1) existing = recoverable;
      }
    }
    const uploadId = existing?.id ?? `upload_${crypto.randomUUID()}`;
    if (!existing) {
      await this.db.prepare("INSERT INTO chapter_uploads(document_id,id,manifest_hash,total_chapters,status,created_at) VALUES(?,?,?,?,'uploading',?)")
        .bind(documentId, uploadId, manifestHash, totalChapters, new Date().toISOString()).run();
    }
    const staged = await this.db.prepare("SELECT chapter_id FROM chapter_upload_items WHERE document_id=? AND upload_id=? ORDER BY sort_order")
      .bind(documentId, uploadId).all<{ chapter_id: string }>();
    return { uploadId, manifestHash, totalChapters, status: "uploading" as const, staged: staged.results.map((row) => row.chapter_id) };
  }

  async stageUploadBatch(
    documentId: string,
    uploadId: string,
    items: Array<{ id: string; title: string; volumeTitle: string; order: number; content: TiptapDocument; hash: string; baseRevision: number }>,
  ) {
    const upload = await this.db.prepare("SELECT total_chapters FROM chapter_uploads WHERE document_id=? AND id=? AND status='uploading'")
      .bind(documentId, uploadId).first<{ total_chapters: number }>();
    if (!upload) throw new WorkerHttpError(409, "CHAPTER_UPLOAD_NOT_ACTIVE", "上传会话不存在或已结束");
    const byId = new Map((await this.metadata(documentId, items.map((item) => item.id))).map((row) => [row.id, row]));
    const seenIds = new Set<string>();
    const seenOrders = new Set<number>();
    const prepared = [];
    for (const item of items) {
      if (item.order >= upload.total_chapters || seenIds.has(item.id) || seenOrders.has(item.order)) {
        throw new WorkerHttpError(409, "CHAPTER_UPLOAD_MANIFEST_CONFLICT", "批次章节 ID 或顺序与上传清单冲突", { chapterId: item.id, order: item.order });
      }
      seenIds.add(item.id);
      seenOrders.add(item.order);
      const active = byId.get(item.id);
      if ((active?.revision ?? 0) !== item.baseRevision) throw new WorkerHttpError(409, "CHAPTER_REVISION_CONFLICT", "章节已被其他修改更新", { chapterId: item.id, currentRevision: active?.revision ?? 0 });
      const content = sanitizeDocumentForWrite(convertLongTextBlocksToChapters(item.content as unknown as JSONContent));
      const unchanged = active?.content_hash === item.hash;
      prepared.push({ ...item, content, revision: unchanged ? active.revision : item.baseRevision + 1, unchanged });
    }
    try {
      await this.db.batch(prepared.map((item) => this.db.prepare(
        "INSERT INTO chapter_upload_items(document_id,upload_id,chapter_id,title,volume_title,sort_order,content_hash,base_revision,revision,content_json,hidden) " +
        "VALUES(?,?,?,?,?,?,?,?,?,?,COALESCE((SELECT hidden FROM chapters WHERE document_id=? AND id=?),0)) " +
        "ON CONFLICT(document_id,upload_id,chapter_id) DO UPDATE SET title=excluded.title,volume_title=excluded.volume_title,sort_order=excluded.sort_order,content_hash=excluded.content_hash,base_revision=excluded.base_revision,revision=excluded.revision,content_json=excluded.content_json,hidden=excluded.hidden"
      ).bind(documentId, uploadId, item.id, item.title, item.volumeTitle, item.order, item.hash, item.baseRevision, item.revision, JSON.stringify(item.content), documentId, item.id)));
    } catch {
      throw new WorkerHttpError(409, "CHAPTER_UPLOAD_MANIFEST_CONFLICT", "批次与已暂存章节冲突");
    }
    return prepared.map((item) => ({ id: item.id, title: item.title, order: item.order, revision: item.revision, status: item.unchanged ? "unchanged" as const : "saved" as const }));
  }

  async completeUpload(documentId: string, uploadId: string) {
    const upload = await this.db.prepare("SELECT manifest_hash,total_chapters,status,published_at FROM chapter_uploads WHERE document_id=? AND id=?")
      .bind(documentId, uploadId).first<{ manifest_hash: string; total_chapters: number; status: string; published_at: string | null }>();
    if (!upload) throw new WorkerHttpError(404, "CHAPTER_UPLOAD_NOT_FOUND", "上传会话不存在");
    if (upload.status === "published") return { uploadId, manifestHash: upload.manifest_hash, totalChapters: upload.total_chapters, publishedAt: upload.published_at! };
    if (upload.status !== "uploading") throw new WorkerHttpError(409, "CHAPTER_UPLOAD_NOT_ACTIVE", "上传会话正在由其他请求发布");
    const frozen = await this.db.prepare("UPDATE chapter_uploads SET status='aborted' WHERE document_id=? AND id=? AND status='uploading'").bind(documentId, uploadId).run();
    if (frozen.meta.changes !== 1) throw new WorkerHttpError(409, "CHAPTER_UPLOAD_NOT_ACTIVE", "上传会话正在由其他请求发布");
    const reopen = () => this.db.prepare("UPDATE chapter_uploads SET status='uploading' WHERE document_id=? AND id=? AND status='aborted'").bind(documentId, uploadId).run();
    const result = await this.db.prepare("SELECT chapter_id,title,volume_title,sort_order,content_hash,base_revision FROM chapter_upload_items WHERE document_id=? AND upload_id=? ORDER BY sort_order")
      .bind(documentId, uploadId).all<{ chapter_id: string; title: string; volume_title: string; sort_order: number; content_hash: string; base_revision: number }>();
    const items = result.results;
    const invalidOrder = items.findIndex((item, index) => item.sort_order !== index);
    const manifestHash = await sha256Hex(new TextEncoder().encode(JSON.stringify(items.map((item) => ({ id: item.chapter_id, title: item.title, volumeTitle: item.volume_title, order: item.sort_order, hash: item.content_hash })))));
    if (items.length !== upload.total_chapters || invalidOrder >= 0 || manifestHash !== upload.manifest_hash) {
      await reopen();
      throw new WorkerHttpError(409, "CHAPTER_UPLOAD_INCOMPLETE", "上传章节数量、顺序或清单哈希不完整", { staged: items.length, expected: upload.total_chapters, invalidOrder });
    }
    const conflict = await this.db.prepare(
      "SELECT item.chapter_id, item.base_revision, COALESCE(chapter.revision, 0) AS current_revision " +
      "FROM chapter_upload_items item LEFT JOIN chapters chapter " +
      "ON chapter.document_id=item.document_id AND chapter.id=item.chapter_id " +
      "WHERE item.document_id=? AND item.upload_id=? " +
      "AND COALESCE(chapter.revision, 0)<>item.base_revision LIMIT 1",
    ).bind(documentId, uploadId).first<{ chapter_id: string; base_revision: number; current_revision: number }>();
    if (conflict) {
      await reopen();
      throw new WorkerHttpError(409, "CHAPTER_REVISION_CONFLICT", "发布前章节基线发生变化", { chapterId: conflict.chapter_id, baseRevision: conflict.base_revision, currentRevision: conflict.current_revision });
    }
    const publishedAt = new Date().toISOString();
    try {
      await this.db.batch([
        this.db.prepare("UPDATE chapters SET sort_order=-sort_order-1 WHERE document_id=?").bind(documentId),
        this.db.prepare(
          "INSERT INTO chapters(id,title,volume_title,sort_order,document_id,revision,content_json,content_hash,updated_at,hidden) " +
          "SELECT chapter_id,title,volume_title,sort_order,document_id,revision,content_json,content_hash,?,hidden FROM chapter_upload_items WHERE document_id=? AND upload_id=? " +
          "ON CONFLICT(document_id,id) DO UPDATE SET title=excluded.title,volume_title=excluded.volume_title,sort_order=excluded.sort_order,revision=excluded.revision,content_json=excluded.content_json,content_hash=excluded.content_hash,updated_at=excluded.updated_at,hidden=excluded.hidden"
        ).bind(publishedAt, documentId, uploadId),
        this.db.prepare("DELETE FROM chapters WHERE document_id=? AND id NOT IN (SELECT chapter_id FROM chapter_upload_items WHERE document_id=? AND upload_id=?)").bind(documentId, documentId, uploadId),
        this.db.prepare("UPDATE chapter_uploads SET status='published',published_at=? WHERE document_id=? AND id=? AND status='aborted'").bind(publishedAt, documentId, uploadId),
      ]);
    } catch (error) {
      await reopen();
      throw new WorkerHttpError(409, "CHAPTER_UPLOAD_PUBLISH_CONFLICT", "原子发布章节失败", { detail: error instanceof Error ? error.message : String(error) });
    }
    return { uploadId, manifestHash, totalChapters: items.length, publishedAt };
  }

  private async metadata(
    documentId: string,
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
          "WHERE document_id = ? AND id IN (" + placeholders + ")",
      )
      .bind(documentId, ...ids)
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
   * 与单章 save 相同的语义：先整批预校验（order 冲突、
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
      (await this.metadata(documentId, items.map((item) => item.id))).map((row) => [
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
    const now = new Date().toISOString();
    for (const item of items) {
      const existing = byId.get(item.id);
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
        throw new WorkerHttpError(409, "CHAPTER_ORDER_CONFLICT", "目标顺序已被其他章节占用，禁止自动搬移线上章节", { chapterId: item.id, occupiedBy: occupied.id });
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
      ...write.map((item) =>
        this.db
          .prepare(
            "INSERT INTO chapters(" +
              "id, title, sort_order, document_id, revision, content_json, content_hash, updated_at, hidden" +
              ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0) " +
              "ON CONFLICT(document_id, id) DO UPDATE SET " +
              "title = excluded.title, sort_order = excluded.sort_order, " +
              "revision = excluded.revision, content_json = excluded.content_json, " +
              "content_hash = excluded.content_hash, updated_at = excluded.updated_at " +
              "WHERE chapters.revision = ?",
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
      const changed =
        executed[index] === undefined ||
        executed[index]!.meta.changes > 0;
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
      const current = await this.metadata(documentId, [item.id]);
      const row = current[0];
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
      (await this.metadata(documentId, items.map((item) => item.id))).map((row) => [
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
      const current = await this.metadata(documentId, [item.id]);
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
      (await this.metadata(documentId, items.map((item) => item.id))).map((row) => [
        row.id,
        row,
      ]),
    );
    const docOrders = await this.documentOrders(documentId);
    for (const item of items) {
      const existing = byId.get(item.id);
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
      (await this.metadata(documentId, items.map((item) => item.id))).map((row) => [
        row.id,
        row,
      ]),
    );
    const docOrders = await this.documentOrders(documentId);
    for (const item of items) {
      const existing = byId.get(item.id);
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
