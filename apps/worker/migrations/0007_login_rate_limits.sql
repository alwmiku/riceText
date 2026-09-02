-- 登录限流按来源地址哈希记录，不保存原始 IP；成功登录后清除当前窗口。
CREATE TABLE login_rate_limits (
  key_hash TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 0)
);
CREATE INDEX login_rate_limits_window_idx ON login_rate_limits(window_started_at);

-- 清除旧版按账号锁定留下的状态，后续只使用统一来源限流。
UPDATE password_credentials SET failed_attempts = 0, locked_until = NULL;
