-- 幂等写入记录使用独立时间字段，禁止从 client_mutation_id 推导时间。
PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE document_mutations_with_created_at (
  document_id TEXT NOT NULL,
  client_mutation_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, client_mutation_id),
  FOREIGN KEY (document_id, revision)
    REFERENCES document_revisions(document_id, revision)
);

INSERT INTO document_mutations_with_created_at(
  document_id, client_mutation_id, request_json, revision, created_at
)
SELECT
  mutation.document_id,
  mutation.client_mutation_id,
  mutation.request_json,
  mutation.revision,
  COALESCE(
    revision.created_at,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
FROM document_mutations AS mutation
LEFT JOIN document_revisions AS revision
  ON revision.document_id = mutation.document_id
 AND revision.revision = mutation.revision;

DROP TABLE document_mutations;
ALTER TABLE document_mutations_with_created_at RENAME TO document_mutations;
CREATE INDEX document_mutations_created_idx ON document_mutations(created_at);
