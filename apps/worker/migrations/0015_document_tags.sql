-- 文章标签：整篇文章的元数据，与章节无关。
--
-- 两类标签共用 document_tags：
-- - server：引用站点字典 tags 里的条目（tag_id 非空），只有版主能维护字典；
-- - author：作者手打的标签，只属于这篇文章，绝不因此往字典里写新行。
-- 标签不参与正文版本：不写 document_revisions / chapter_revisions，也不改
-- documents.current_revision，因此加标签不会造成「未保存」或基线冲突。
PRAGMA defer_foreign_keys = TRUE;

-- 站点标签字典。slug 是对外稳定标识（创建后不可修改），label 可修正。
CREATE TABLE tags (
  id          TEXT    PRIMARY KEY,
  slug        TEXT    NOT NULL UNIQUE,
  label       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  -- 只做软隐藏：不再出现在候选与读者视图里，历史引用仍然保留。
  hidden      INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_by  TEXT    REFERENCES users(id),
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
CREATE INDEX tags_visible_idx ON tags(hidden, label);

CREATE TABLE document_tags (
  document_id TEXT    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  -- 同一篇文章内的去重键：标签文本规范化后的 slug。
  slug        TEXT    NOT NULL,
  -- 展示副本；字典改名时由下面的触发器一起更新。
  label       TEXT    NOT NULL,
  tag_id      TEXT    REFERENCES tags(id),
  source      TEXT    NOT NULL CHECK (source IN ('server', 'author')),
  position    INTEGER NOT NULL,
  created_by  TEXT    REFERENCES users(id),
  created_at  TEXT    NOT NULL,
  PRIMARY KEY (document_id, slug),
  -- 来源与引用不能自相矛盾：服务器标签必须有字典行，作者标签必须没有。
  CHECK ((source = 'server') = (tag_id IS NOT NULL))
);
CREATE INDEX document_tags_tag_idx ON document_tags(tag_id);
CREATE INDEX document_tags_position_idx ON document_tags(document_id, position);

-- 每篇文章最多 5 个标签（与 contracts 的 TAG_LIMIT 一致）。
-- 仓储已先校验，这里再兜一层，保证任何写入路径都不会越过上限。
CREATE TRIGGER document_tags_limit BEFORE INSERT ON document_tags
WHEN (SELECT COUNT(*) FROM document_tags WHERE document_id = NEW.document_id) >= 5
BEGIN SELECT RAISE(ABORT, 'TAG_LIMIT_EXCEEDED'); END;

-- 字典改名后，引用它的文章展示文本必须一起更新。
CREATE TRIGGER tags_label_sync AFTER UPDATE OF label ON tags
WHEN NEW.label <> OLD.label
BEGIN
  UPDATE document_tags SET label = NEW.label WHERE tag_id = NEW.id;
END;
