-- 发布时在 uploading 会话上设置有期限的令牌；aborted 表示已暂停。
ALTER TABLE chapter_uploads ADD COLUMN publish_token TEXT;
ALTER TABLE chapter_uploads ADD COLUMN publish_expires_at TEXT;
ALTER TABLE chapter_uploads ADD COLUMN base_generation INTEGER NOT NULL DEFAULT 0;
-- 迁移前的上传没有完整章节集快照。保留暂存数据和回执，
-- 但要求新建会话，不能假定清单未包含的章节保持不变。
UPDATE chapter_uploads SET base_generation=-1 WHERE status<>'published';

-- 跟踪当前完整章节集，包括替换清单未包含的章节。
CREATE TABLE chapter_generations (
  document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL DEFAULT 0
);
INSERT INTO chapter_generations(document_id) SELECT id FROM documents;
CREATE TRIGGER chapter_generation_document AFTER INSERT ON documents BEGIN
  INSERT INTO chapter_generations(document_id) VALUES (NEW.id);
END;
CREATE TRIGGER chapter_generation_insert AFTER INSERT ON chapters BEGIN
  UPDATE chapter_generations SET generation=generation+1 WHERE document_id=NEW.document_id;
END;
CREATE TRIGGER chapter_generation_update AFTER UPDATE ON chapters BEGIN
  UPDATE chapter_generations SET generation=generation+1 WHERE document_id=OLD.document_id OR document_id=NEW.document_id;
END;
CREATE TRIGGER chapter_generation_delete AFTER DELETE ON chapters BEGIN
  UPDATE chapter_generations SET generation=generation+1 WHERE document_id=OLD.document_id;
END;
CREATE TRIGGER chapter_upload_baseline AFTER INSERT ON chapter_uploads BEGIN
  UPDATE chapter_uploads SET base_generation=(SELECT generation FROM chapter_generations WHERE document_id=NEW.document_id)
  WHERE document_id=NEW.document_id AND id=NEW.id;
END;

CREATE TRIGGER chapter_upload_item_insert BEFORE INSERT ON chapter_upload_items
WHEN EXISTS (SELECT 1 FROM chapter_uploads WHERE document_id=NEW.document_id AND id=NEW.upload_id AND (status<>'uploading' OR publish_token IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'CHAPTER_UPLOAD_NOT_ACTIVE'); END;
CREATE TRIGGER chapter_upload_item_update BEFORE UPDATE ON chapter_upload_items
WHEN EXISTS (SELECT 1 FROM chapter_uploads WHERE (document_id=NEW.document_id AND id=NEW.upload_id OR document_id=OLD.document_id AND id=OLD.upload_id) AND (status<>'uploading' OR publish_token IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'CHAPTER_UPLOAD_NOT_ACTIVE'); END;
CREATE TRIGGER chapter_upload_item_delete BEFORE DELETE ON chapter_upload_items
WHEN EXISTS (SELECT 1 FROM chapter_uploads WHERE document_id=OLD.document_id AND id=OLD.upload_id AND publish_token IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'CHAPTER_UPLOAD_NOT_ACTIVE'); END;

-- 在同一个发布批次内插入并删除。RAISE 中止当前语句，
-- D1 回滚整个批次，包括此前执行的语句。
CREATE TABLE chapter_publish_guards (
  document_id TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  token TEXT NOT NULL PRIMARY KEY
);
-- 与 0004 相同：条件保护使用 WHERE，避免远端 D1 将 CASE 的 END 误当作触发器结束。
CREATE TRIGGER chapter_publish_guard BEFORE INSERT ON chapter_publish_guards BEGIN
  SELECT RAISE(ABORT, 'CHAPTER_UPLOAD_NOT_ACTIVE') WHERE NOT EXISTS (
    SELECT 1 FROM chapter_uploads WHERE document_id=NEW.document_id AND id=NEW.upload_id
      AND status='uploading' AND publish_token=NEW.token
      AND julianday(publish_expires_at)>julianday('now')
  );
  SELECT RAISE(ABORT, 'CHAPTER_REVISION_CONFLICT') WHERE NOT EXISTS (
    SELECT 1 FROM chapter_uploads upload JOIN chapter_generations live ON live.document_id=upload.document_id
    WHERE upload.document_id=NEW.document_id AND upload.id=NEW.upload_id AND upload.base_generation=live.generation
  ) OR EXISTS (
    SELECT 1 FROM chapter_upload_items item LEFT JOIN chapters chapter
      ON chapter.document_id=item.document_id AND chapter.id=item.chapter_id
    WHERE item.document_id=NEW.document_id AND item.upload_id=NEW.upload_id
      AND COALESCE(chapter.revision,0)<>item.base_revision
  );
END;
