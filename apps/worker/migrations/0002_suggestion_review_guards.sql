-- 审核 guard 以建议类型和 ID 为唯一键，保证并发 approve/reject 只能成功一次。
CREATE TABLE suggestion_review_guards (
  suggestion_kind TEXT NOT NULL CHECK (suggestion_kind IN ('single', 'batch')),
  suggestion_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (suggestion_kind, suggestion_id)
);
CREATE INDEX suggestion_review_guards_reviewer_idx
  ON suggestion_review_guards(reviewer_id, created_at DESC);
