-- 章节版本账本：章节历史不再由整篇快照与 document_mutations.request_json 推导。
-- 每个章节自己的版本号从 1 连续递增；document_revision 为空表示该版本不来自整篇
-- 不可变快照（独立章节保存、上传发布），此时 content_json 保存该章节的正文快照。
PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE chapter_revisions (
  document_id        TEXT    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chapter_id         TEXT    NOT NULL,
  chapter_revision   INTEGER NOT NULL,
  document_revision  INTEGER,
  operation          TEXT    NOT NULL
    CHECK (operation IN ('seed','update','steps','rollback','suggestion','import')),
  schema_version     INTEGER NOT NULL,
  author_id          TEXT    NOT NULL REFERENCES users(id),
  target_chapter_revision INTEGER,
  steps_json         TEXT,
  content_json       TEXT,
  created_at         TEXT    NOT NULL,
  PRIMARY KEY (document_id, chapter_id, chapter_revision),
  -- 同一整篇快照对一个章节只能归属一次；document_revision 为空时约束不生效。
  UNIQUE (document_id, document_revision, chapter_id),
  FOREIGN KEY (document_id, document_revision)
    REFERENCES document_revisions(document_id, revision)
);
CREATE INDEX chapter_revisions_lookup_idx
  ON chapter_revisions(document_id, chapter_id, chapter_revision DESC);
CREATE INDEX chapter_revisions_created_idx
  ON chapter_revisions(document_id, created_at DESC);

-- 回填历史：1) mutation 明确带 chapterId 的修订；
-- 2) 文档最早快照里出现过该 chapterId 的章节（首版归属）。
WITH mutation_chapter AS (
  SELECT DISTINCT
    mutation.document_id AS document_id,
    json_extract(mutation.request_json, '$.chapterId') AS chapter_id,
    mutation.revision AS document_revision,
    CAST(json_extract(mutation.request_json, '$.targetRevision') AS INTEGER)
      AS target_chapter_revision
  FROM document_mutations AS mutation
  WHERE json_extract(mutation.request_json, '$.chapterId') IS NOT NULL
    AND length(json_extract(mutation.request_json, '$.chapterId')) > 0
),
chapter_universe AS (
  SELECT document_id, id AS chapter_id FROM chapters
  UNION
  SELECT document_id, chapter_id FROM mutation_chapter
),
first_revision AS (
  SELECT document_id, MIN(revision) AS revision
  FROM document_revisions GROUP BY document_id
),
initial AS (
  SELECT universe.document_id, universe.chapter_id,
         first_revision.revision AS document_revision,
         NULL AS target_chapter_revision
  FROM chapter_universe AS universe
  JOIN first_revision ON first_revision.document_id = universe.document_id
  JOIN document_revisions AS snapshot
    ON snapshot.document_id = first_revision.document_id
   AND snapshot.revision = first_revision.revision
  WHERE instr(snapshot.content_json, '"chapterId":"' || universe.chapter_id || '"') > 0
),
attributed AS (
  SELECT document_id, chapter_id, document_revision, target_chapter_revision
  FROM mutation_chapter
  UNION
  SELECT document_id, chapter_id, document_revision, target_chapter_revision
  FROM initial
)
INSERT INTO chapter_revisions(
  document_id, chapter_id, chapter_revision, document_revision, operation,
  schema_version, author_id, target_chapter_revision, steps_json, content_json, created_at
)
SELECT
  attributed.document_id,
  attributed.chapter_id,
  ROW_NUMBER() OVER (
    PARTITION BY attributed.document_id, attributed.chapter_id
    ORDER BY attributed.document_revision
  ),
  attributed.document_revision,
  snapshot.operation,
  snapshot.schema_version,
  snapshot.author_id,
  CASE WHEN snapshot.operation = 'rollback' THEN attributed.target_chapter_revision END,
  snapshot.steps_json,
  NULL,
  snapshot.created_at
FROM attributed
JOIN document_revisions AS snapshot
  ON snapshot.document_id = attributed.document_id
 AND snapshot.revision = attributed.document_revision;
