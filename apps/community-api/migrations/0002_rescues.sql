-- 0002_rescues: v0.3 抢救票（名单不是永久刑罚）。
CREATE TABLE rescues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handle TEXT NOT NULL,
  evidence_post_id TEXT,
  installation_id TEXT NOT NULL,
  client_version TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_rescues_installation_handle ON rescues (installation_id, handle);
CREATE INDEX idx_rescues_handle ON rescues (handle);

ALTER TABLE installations ADD COLUMN rescues_day TEXT NOT NULL DEFAULT '';
ALTER TABLE installations ADD COLUMN rescues_today INTEGER NOT NULL DEFAULT 0;
