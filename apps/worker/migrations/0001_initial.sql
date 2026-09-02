-- D1 基线：一次建立与 Node SQLite 对齐的业务表，并补齐生产认证和 R2 元数据。
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('author', 'reader', 'moderator')),
  is_friend INTEGER NOT NULL DEFAULT 0 CHECK (is_friend IN (0, 1)),
  bio TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE auth_identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (issuer, subject)
);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id, expires_at);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  current_revision INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE document_acl (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('read', 'edit', 'admin')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, user_id)
);
CREATE INDEX document_acl_user_idx ON document_acl(user_id, permission);

CREATE TABLE document_revisions (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  steps_json TEXT,
  author_id TEXT NOT NULL REFERENCES users(id),
  operation TEXT NOT NULL CHECK (operation IN ('seed', 'update', 'rollback', 'suggestion', 'steps')),
  target_revision INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, revision)
);
CREATE INDEX document_revisions_created_idx ON document_revisions(document_id, created_at DESC);

CREATE TABLE document_mutations (
  document_id TEXT NOT NULL,
  client_mutation_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY (document_id, client_mutation_id),
  FOREIGN KEY (document_id, revision) REFERENCES document_revisions(document_id, revision)
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  object_key TEXT UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  checksum TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'ready', 'failed')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX assets_state_idx ON assets(state, updated_at);

CREATE TABLE dice_rolls (
  id TEXT PRIMARY KEY,
  root_roll_id TEXT NOT NULL,
  previous_roll_id TEXT REFERENCES dice_rolls(id),
  expression TEXT NOT NULL,
  details_json TEXT NOT NULL,
  total REAL NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE comment_threads (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  anchor_id TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, anchor_id)
);

CREATE TABLE comment_replies (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  anchor_id TEXT NOT NULL,
  parent_id TEXT REFERENCES comment_replies(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (document_id, anchor_id) REFERENCES comment_threads(document_id, anchor_id)
);
CREATE INDEX comment_replies_thread_idx ON comment_replies(document_id, anchor_id, created_at DESC);

CREATE TABLE comment_votes (
  reply_id TEXT NOT NULL REFERENCES comment_replies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (reply_id, user_id)
);

CREATE TABLE chapters (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1,
  content_json TEXT,
  content_hash TEXT,
  updated_at TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  UNIQUE (document_id, sort_order)
);
CREATE INDEX chapters_document_idx ON chapters(document_id, sort_order);

CREATE TABLE suggestions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
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
  reviewed_at TEXT
);
CREATE INDEX suggestions_document_idx ON suggestions(document_id, status, created_at DESC);
CREATE INDEX suggestions_chapter_idx ON suggestions(chapter_id, status, created_at DESC);

CREATE TABLE suggestion_batches (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL,
  chapter_title TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  before_content_json TEXT NOT NULL,
  after_content_json TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  author_id TEXT NOT NULL REFERENCES users(id),
  reviewer_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX suggestion_batches_document_idx ON suggestion_batches(document_id, status, created_at DESC);
CREATE INDEX suggestion_batches_chapter_idx ON suggestion_batches(chapter_id, status, created_at DESC);

CREATE TABLE reply_gates (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content_json TEXT NOT NULL
);

CREATE TABLE reply_receipts (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, user_id)
);

CREATE TABLE wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  balance INTEGER NOT NULL CHECK (balance >= 0)
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  author_id TEXT NOT NULL REFERENCES users(id),
  asset_id TEXT REFERENCES assets(id),
  legacy_download_url TEXT
);

CREATE TABLE attachment_purchases (
  attachment_id TEXT NOT NULL REFERENCES attachments(id),
  buyer_id TEXT NOT NULL REFERENCES users(id),
  price INTEGER NOT NULL,
  author_income INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (attachment_id, buyer_id)
);
CREATE INDEX attachment_purchases_buyer_idx ON attachment_purchases(buyer_id, created_at DESC);

CREATE TABLE polls (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  multiple INTEGER NOT NULL CHECK (multiple IN (0, 1)),
  minimum_role TEXT NOT NULL
);

CREATE TABLE poll_options (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
CREATE INDEX poll_options_poll_idx ON poll_options(poll_id, sort_order);

CREATE TABLE poll_votes (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (poll_id, user_id)
);
CREATE INDEX poll_votes_poll_idx ON poll_votes(poll_id, created_at DESC);

CREATE TABLE poll_vote_options (
  vote_id TEXT NOT NULL REFERENCES poll_votes(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES poll_options(id),
  PRIMARY KEY (vote_id, option_id)
);
