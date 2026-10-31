-- Access 管理后台的工作区与发布记录。
-- 维护者在后台编辑的是 draft；公开名单和词库只在明确发布时变化。

CREATE TABLE admin_account_drafts (
  handle TEXT PRIMARY KEY,
  x_user_id TEXT,
  category TEXT NOT NULL,
  note TEXT NOT NULL,
  evidence_post_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_admin_account_drafts_active
  ON admin_account_drafts (active, updated_at DESC, handle);

CREATE TABLE admin_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('accounts', 'keywords')),
  version TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_admin_releases_created
  ON admin_releases (created_at DESC, id DESC);
