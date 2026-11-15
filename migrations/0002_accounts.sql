-- Accounts (gap #14, owner-approved 2026-11-15): email magic-link sign-in, so saved properties,
-- reports and report branding follow a realtor across devices, plus read-only share links.
-- Applied by hand through .github/workflows/d1-migrations.yml (workflow_dispatch, main only).
-- Until it is applied the Worker reports accounts as unavailable and the app keeps using
-- localStorage (src/services/accounts-store.js checks for these tables).
--
-- Times are Unix milliseconds. Secrets are never stored: login tokens, session ids and share
-- tokens are stored as SHA-256 hashes only. No owner names or mailing addresses are stored:
-- report and saved-property JSON go through withoutPersonalFields() before every write.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_login_tokens_email ON login_tokens(email, created_at);
CREATE INDEX IF NOT EXISTS idx_login_tokens_ip ON login_tokens(created_ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_login_tokens_expires ON login_tokens(expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS saved_properties (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  data_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id, created_at);

CREATE TABLE IF NOT EXISTS branding (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS share_links (
  token_hash TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_share_links_report ON share_links(report_id);
CREATE INDEX IF NOT EXISTS idx_share_links_user ON share_links(user_id);
