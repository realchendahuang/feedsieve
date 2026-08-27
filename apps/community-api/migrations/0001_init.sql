-- 0001_init: v0.2 基础 schema。时间戳一律 unix seconds (UTC)。
-- 隐私红线：installation 只存服务器加盐哈希，绝不存原始 UUID / IP / 任何可反推身份的数据。

-- 举报者安装实例（匿名；id = sha256(INSTALLATION_SALT + client uuid) hex）
CREATE TABLE installations (
  id TEXT PRIMARY KEY,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  reports_day TEXT NOT NULL DEFAULT '',
  reports_today INTEGER NOT NULL DEFAULT 0
);

-- 聚合账号（公开快照唯一数据源；handle 小写主键）
CREATE TABLE accounts (
  handle TEXT PRIMARY KEY,
  x_user_id TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  status TEXT NOT NULL DEFAULT 'candidate',
  report_count INTEGER NOT NULL DEFAULT 0,
  rescue_count INTEGER NOT NULL DEFAULT 0,
  first_report_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 原始上报（append-only；installation_id 为哈希）
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handle TEXT NOT NULL,
  x_user_id TEXT,
  reason TEXT NOT NULL,
  evidence_post_id TEXT,
  installation_id TEXT NOT NULL,
  client_version TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_reports_installation_handle ON reports (installation_id, handle);
CREATE INDEX idx_reports_handle ON reports (handle);

-- 已发布快照（version 形如 2026.08.27.1；files_json 含每文件 JSON + sha256）
CREATE TABLE snapshots (
  version TEXT PRIMARY KEY,
  manifest_json TEXT NOT NULL,
  files_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
