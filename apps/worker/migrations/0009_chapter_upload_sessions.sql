-- 长文本批量上传先写独立暂存区，完整验收后再原子替换线上章节。
CREATE TABLE chapter_uploads (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  total_chapters INTEGER NOT NULL CHECK (total_chapters > 0 AND total_chapters <= 10000),
  status TEXT NOT NULL CHECK (status IN ('uploading', 'published', 'aborted')),
  created_at TEXT NOT NULL,
  published_at TEXT,
  PRIMARY KEY (document_id, id)
);
CREATE INDEX chapter_uploads_manifest_idx
  ON chapter_uploads(document_id, manifest_hash, status, created_at DESC);

CREATE TABLE chapter_upload_items (
  document_id TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  PRIMARY KEY (document_id, upload_id, chapter_id),
  UNIQUE (document_id, upload_id, sort_order),
  FOREIGN KEY (document_id, upload_id)
    REFERENCES chapter_uploads(document_id, id) ON DELETE CASCADE
);
CREATE INDEX chapter_upload_items_order_idx
  ON chapter_upload_items(document_id, upload_id, sort_order);
