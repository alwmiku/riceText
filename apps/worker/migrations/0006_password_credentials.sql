-- 本地账号只保存慢哈希参数；用户名不区分大小写，密码明文永不进入 D1。
CREATE TABLE password_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  iterations INTEGER NOT NULL CHECK (iterations >= 100000),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX password_credentials_lock_idx ON password_credentials(locked_until);
