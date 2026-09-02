-- OIDC 临时状态只保存短期 PKCE/nonce 数据，回调时原子删除以防重放。
CREATE TABLE auth_login_states (
  state_hash TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX auth_login_states_expiry_idx ON auth_login_states(expires_at);
