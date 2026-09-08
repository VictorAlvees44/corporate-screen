CREATE TABLE IF NOT EXISTS json_store (
  file_name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_json_store_updated_at ON json_store(updated_at);
