-- 校订审核改为章节级并发基线：审核只需目标章节内容未变，不再要求整篇文档版本一致。
PRAGMA defer_foreign_keys = TRUE;

-- 建议/批次记录提交时目标章节的内容版本；迁移前的旧行保持 NULL，继续走整篇守卫。
ALTER TABLE suggestions        ADD COLUMN base_chapter_revision INTEGER;
ALTER TABLE suggestion_batches ADD COLUMN base_chapter_revision INTEGER;

CREATE TABLE chapter_write_guards (
  document_id TEXT NOT NULL,
  chapter_id  TEXT NOT NULL,
  expected_chapter_revision INTEGER NOT NULL,
  PRIMARY KEY (document_id, chapter_id)
);

-- 触发器条件用 SELECT RAISE(...) WHERE，禁止嵌套 CASE（远端 D1 分句器限制）。
CREATE TRIGGER chapter_write_guard BEFORE INSERT ON chapter_write_guards BEGIN
  SELECT RAISE(ABORT, 'CHAPTER_REVISION_CONFLICT') WHERE (
    SELECT COALESCE(MAX(chapter_revision), 0) FROM chapter_revisions
    WHERE document_id = NEW.document_id AND chapter_id = NEW.chapter_id
  ) <> NEW.expected_chapter_revision;
END;
