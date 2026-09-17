import {
  DocumentTagSchema,
  TagSchema,
  createEntityId,
  normalizeTagLabel,
  resolveDocumentTags,
  tagSlug,
  type DocumentTag,
  type Tag,
} from "@ricetext/contracts";
import { WorkerHttpError } from "../http-error";

type TagRow = {
  id: string;
  slug: string;
  label: string;
  description: string;
  hidden: number;
};

type DocumentTagRow = {
  slug: string;
  label: string;
  tag_id: string | null;
  source: "server" | "author";
  hidden: number | null;
};

/** 标签仓储：文章标签是整篇文章的元数据，读写都不经过正文写入路径。 */
export class D1TagRepository {
  constructor(private readonly db: D1Database) {}

  private toTag(row: TagRow): Tag {
    return TagSchema.parse({
      id: row.id,
      slug: row.slug,
      label: row.label,
      description: row.description,
      hidden: row.hidden === 1,
    });
  }

  /** 读取一篇文章的标签；`includeHidden` 供编辑器保留已隐藏的服务器标签。 */
  async documentTags(
    documentId: string,
    options: { includeHidden?: boolean } = {},
  ): Promise<DocumentTag[]> {
    const rows = await this.db
      .prepare(
        "SELECT tag.slug, tag.label, tag.tag_id, tag.source, dictionary.hidden AS hidden " +
          "FROM document_tags tag " +
          "LEFT JOIN tags dictionary ON dictionary.id = tag.tag_id " +
          "WHERE tag.document_id = ? ORDER BY tag.position",
      )
      .bind(documentId)
      .all<DocumentTagRow>();
    return rows.results
      .filter((row) => options.includeHidden || row.hidden !== 1)
      .map((row) =>
        DocumentTagSchema.parse({
          slug: row.slug,
          label: row.label,
          source: row.source,
          tagId: row.tag_id,
        }),
      );
  }

  async documentExists(documentId: string): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT 1 AS found FROM documents WHERE id = ?")
      .bind(documentId)
      .first<{ found: number }>();
    return Boolean(row);
  }

  /**
   * 全量替换文章标签。
   *
   * 校验、删除旧标签、写入新标签在同一条 D1 batch 里执行：D1 把 batch 当成事务，
   * 中途失败不会留下「删了一半」的文章。文本命中未隐藏的站点标签时归为服务器标签，
   * 其余只写进这篇文章，不创建字典行。
   */
  async replaceDocumentTags(
    documentId: string,
    labels: readonly string[],
    authorId: string,
  ): Promise<DocumentTag[]> {
    if (!(await this.documentExists(documentId))) {
      throw new WorkerHttpError(404, "DOCUMENT_NOT_FOUND", "文档不存在");
    }
    const resolved = resolveDocumentTags(labels, await this.serverTags({ includeHidden: true }));
    if (!resolved.ok) {
      throw new WorkerHttpError(422, resolved.code, resolved.message);
    }
    const createdAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      this.db.prepare("DELETE FROM document_tags WHERE document_id = ?").bind(documentId),
    ];
    resolved.tags.forEach((tag, index) => {
      statements.push(
        this.db
          .prepare(
            "INSERT INTO document_tags(document_id, slug, label, tag_id, source, position, created_by, created_at) " +
              "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(documentId, tag.slug, tag.label, tag.tagId, tag.source, index, authorId, createdAt),
      );
    });
    try {
      await this.db.batch(statements);
    } catch (error) {
      // 迁移里的 document_tags_limit 触发器是最后一道闸；把它翻译回契约错误码。
      if (String(error).includes("TAG_LIMIT_EXCEEDED")) {
        throw new WorkerHttpError(422, "TAG_LIMIT_EXCEEDED", "一篇文章最多 5 个标签");
      }
      throw error;
    }
    return this.documentTags(documentId, { includeHidden: true });
  }

  /** 读取站点标签字典；默认不含已隐藏条目。 */
  async serverTags(options: { includeHidden?: boolean } = {}): Promise<Tag[]> {
    const rows = await this.db
      .prepare(
        "SELECT id, slug, label, description, hidden FROM tags " +
          (options.includeHidden ? "" : "WHERE hidden = 0 ") +
          "ORDER BY hidden, label",
      )
      .all<TagRow>();
    return rows.results.map((row) => this.toTag(row));
  }

  /** 新建站点标签；slug 由 label 推导且此后不可修改。 */
  async createServerTag(
    input: { label: string; description?: string | undefined },
    authorId: string,
  ): Promise<Tag> {
    const label = normalizeTagLabel(input.label);
    if (!label) {
      throw new WorkerHttpError(
        422,
        "TAG_LABEL_INVALID",
        "标签文本不合法：1-24 个字符，且不能只有标点",
      );
    }
    const slug = tagSlug(label);
    const clash = await this.db
      .prepare("SELECT id FROM tags WHERE slug = ? OR lower(label) = lower(?)")
      .bind(slug, label)
      .first<{ id: string }>();
    if (clash) {
      throw new WorkerHttpError(409, "TAG_SLUG_CONFLICT", `标签「${label}」已存在`);
    }
    const id = createEntityId("tag");
    const now = new Date().toISOString();
    await this.db
      .prepare(
        "INSERT INTO tags(id, slug, label, description, hidden, created_by, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, 0, ?, ?, ?)",
      )
      .bind(id, slug, label, input.description ?? "", authorId, now, now)
      .run();
    return this.requireTag(id);
  }

  /**
   * 维护站点标签：slug 不可改；改 label 时由 tags_label_sync 触发器同步所有引用；
   * hidden 只做软隐藏，已挂在文章上的引用不会消失。
   */
  async updateServerTag(
    tagId: string,
    input: { label?: string | undefined; description?: string | undefined; hidden?: boolean | undefined },
  ): Promise<Tag> {
    const current = await this.requireTagRow(tagId);
    let label = current.label;
    if (input.label !== undefined) {
      const normalized = normalizeTagLabel(input.label);
      if (!normalized) {
        throw new WorkerHttpError(
          422,
          "TAG_LABEL_INVALID",
          "标签文本不合法：1-24 个字符，且不能只有标点",
        );
      }
      label = normalized;
      if (normalized !== current.label) {
        const clash = await this.db
          .prepare("SELECT id FROM tags WHERE id <> ? AND (slug = ? OR lower(label) = lower(?))")
          .bind(tagId, tagSlug(normalized), normalized)
          .first<{ id: string }>();
        if (clash) {
          throw new WorkerHttpError(409, "TAG_SLUG_CONFLICT", `标签「${label}」已存在`);
        }
      }
    }
    await this.db
      .prepare("UPDATE tags SET label = ?, description = ?, hidden = ?, updated_at = ? WHERE id = ?")
      .bind(
        label,
        input.description ?? current.description,
        (input.hidden ?? current.hidden === 1) ? 1 : 0,
        new Date().toISOString(),
        tagId,
      )
      .run();
    return this.requireTag(tagId);
  }

  private async requireTagRow(tagId: string): Promise<TagRow> {
    const row = await this.db
      .prepare("SELECT id, slug, label, description, hidden FROM tags WHERE id = ?")
      .bind(tagId)
      .first<TagRow>();
    if (!row) throw new WorkerHttpError(404, "TAG_NOT_FOUND", "标签不存在");
    return row;
  }

  private async requireTag(tagId: string): Promise<Tag> {
    return this.toTag(await this.requireTagRow(tagId));
  }
}
