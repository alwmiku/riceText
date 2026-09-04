-- 章节 ID 只在所属文章内唯一；文章与章节共同组成存储身份。
PRAGMA defer_foreign_keys = TRUE;
ALTER TABLE suggestions RENAME TO suggestions_global_chapter_id;
ALTER TABLE chapters RENAME TO chapters_global_id;

CREATE TABLE chapters (
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1,
  content_json TEXT,
  content_hash TEXT,
  updated_at TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  PRIMARY KEY (document_id, id),
  UNIQUE (document_id, sort_order)
);

INSERT INTO chapters(
  id, title, sort_order, document_id, revision, content_json,
  content_hash, updated_at, hidden
)
SELECT
  id, title, sort_order, document_id, revision, content_json,
  content_hash, updated_at, hidden
FROM chapters_global_id;

CREATE TABLE suggestions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chapter_id TEXT,
  chapter_title TEXT NOT NULL DEFAULT '',
  line_no INTEGER NOT NULL DEFAULT 0,
  line_text TEXT NOT NULL DEFAULT '',
  from_text TEXT NOT NULL,
  to_text TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  author_id TEXT NOT NULL REFERENCES users(id),
  reviewer_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  FOREIGN KEY (document_id, chapter_id)
    REFERENCES chapters(document_id, id)
);

INSERT INTO suggestions(
  id, document_id, chapter_id, chapter_title, line_no, line_text,
  from_text, to_text, reason, status, author_id, reviewer_id,
  created_at, reviewed_at
)
SELECT
  suggestion.id,
  suggestion.document_id,
  CASE
    WHEN suggestion.chapter_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM chapters
      WHERE chapters.document_id = suggestion.document_id
        AND chapters.id = suggestion.chapter_id
    ) THEN suggestion.chapter_id
    ELSE NULL
  END,
  suggestion.chapter_title,
  suggestion.line_no,
  suggestion.line_text,
  suggestion.from_text,
  suggestion.to_text,
  suggestion.reason,
  suggestion.status,
  suggestion.author_id,
  suggestion.reviewer_id,
  suggestion.created_at,
  suggestion.reviewed_at
FROM suggestions_global_chapter_id AS suggestion;

DROP TABLE suggestions_global_chapter_id;
DROP TABLE chapters_global_id;

CREATE INDEX chapters_document_idx ON chapters(document_id, sort_order);
CREATE INDEX suggestions_document_idx
  ON suggestions(document_id, status, created_at DESC);
CREATE INDEX suggestions_chapter_idx
  ON suggestions(document_id, chapter_id, status, created_at DESC);
