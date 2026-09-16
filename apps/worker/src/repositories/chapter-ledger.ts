/** 账本里的章节版本操作；与 document_revisions.operation 一致，并增加上传导入。 */
export type ChapterRevisionOperation =
  | "seed"
  | "update"
  | "steps"
  | "rollback"
  | "suggestion"
  | "import";

export interface ChapterRevisionAppend {
  documentId: string;
  chapterId: string;
  /** 整篇不可变快照号；null 表示该版本不来自整篇快照（独立章节保存、上传发布）。 */
  documentRevision: number | null;
  operation: ChapterRevisionOperation;
  schemaVersion: number;
  authorId: string;
  /** 回滚目标：该章节自己的版本号。 */
  targetChapterRevision?: number | null;
  stepsJson?: string | null;
  /** 仅 documentRevision 为 null 时保存章节正文快照。 */
  contentJson?: string | null;
  createdAt: string;
}

/**
 * 追加一行章节版本。
 *
 * 章节版本号取该章节账本自身的 MAX+1，因此调用方不需要（也不允许）自算位置；
 * 语句与修订、幂等记录、chapters 更新处在同一个 D1 batch 内，整体原子提交。
 */
export function appendChapterRevision(
  db: D1Database,
  input: ChapterRevisionAppend,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO chapter_revisions(" +
        "document_id, chapter_id, chapter_revision, document_revision, operation, " +
        "schema_version, author_id, target_chapter_revision, steps_json, content_json, created_at" +
        ") SELECT ?, ?, COALESCE(MAX(chapter_revision), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ? " +
        "FROM chapter_revisions WHERE document_id = ? AND chapter_id = ?",
    )
    .bind(
      input.documentId,
      input.chapterId,
      input.documentRevision,
      input.operation,
      input.schemaVersion,
      input.authorId,
      input.targetChapterRevision ?? null,
      input.stepsJson ?? null,
      input.contentJson ?? null,
      input.createdAt,
      input.documentId,
      input.chapterId,
    );
}

/**
 * 只在本次章节 UPSERT 真正写入时才追加账本行。
 *
 * D1 batch 不会因为前置语句改动 0 行而中止，因此用「该行必须等于本次写入的结果」
 * （revision + content_hash + updated_at 三者同时匹配）作为追加条件：
 * 版本守卫失败、他人先写时条件不成立，账本行不会产生。
 */
export function appendSavedChapterRevision(
  db: D1Database,
  input: {
    documentId: string;
    chapterId: string;
    operation: ChapterRevisionOperation;
    schemaVersion: number;
    authorId: string;
    contentJson: string;
    contentHash: string;
    /** 本次写入后该章节行应有的 revision（baseRevision + 1）。 */
    revision: number;
    /** 本次写入使用的 updated_at；与 UPSERT 绑定同一个时间戳。 */
    updatedAt: string;
  },
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO chapter_revisions(" +
        "document_id, chapter_id, chapter_revision, document_revision, operation, " +
        "schema_version, author_id, target_chapter_revision, steps_json, content_json, created_at" +
        ") SELECT ?, ?, COALESCE(MAX(chapter_revision), 0) + 1, NULL, ?, ?, ?, NULL, NULL, ?, ? " +
        "FROM chapter_revisions WHERE document_id = ? AND chapter_id = ? " +
        "AND EXISTS (SELECT 1 FROM chapters WHERE document_id = ? AND id = ? " +
        "AND revision = ? AND content_hash = ? AND updated_at = ?)",
    )
    .bind(
      input.documentId,
      input.chapterId,
      input.operation,
      input.schemaVersion,
      input.authorId,
      input.contentJson,
      input.updatedAt,
      input.documentId,
      input.chapterId,
      input.documentId,
      input.chapterId,
      input.revision,
      input.contentHash,
      input.updatedAt,
    );
}

/** 读取章节当前内容版本；账本里还没有该章节时返回 0。 */
export async function latestChapterRevision(
  db: D1Database,
  documentId: string,
  chapterId: string,
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COALESCE(MAX(chapter_revision), 0) AS revision FROM chapter_revisions " +
        "WHERE document_id = ? AND chapter_id = ?",
    )
    .bind(documentId, chapterId)
    .first<{ revision: number }>();
  return row?.revision ?? 0;
}

/**
 * 在 batch 内声明「该章节必须恰好有 expected 个内容版本」的写前置条件。
 *
 * 守卫表上的触发器在章节已被其他写入推进时 ABORT，整个 batch 回滚，
 * 因此章节级乐观并发不依赖调用方传入的整篇文档版本。
 */
export function chapterRevisionGuard(
  db: D1Database,
  documentId: string,
  chapterId: string,
  expected: number,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO chapter_write_guards(document_id, chapter_id, expected_chapter_revision) " +
        "VALUES (?, ?, ?)",
    )
    .bind(documentId, chapterId, expected);
}

/** 释放守卫行；与守卫插入同批次执行，避免长期占用。 */
export function releaseChapterRevisionGuard(
  db: D1Database,
  documentId: string,
  chapterId: string,
): D1PreparedStatement {
  return db
    .prepare("DELETE FROM chapter_write_guards WHERE document_id = ? AND chapter_id = ?")
    .bind(documentId, chapterId);
}
