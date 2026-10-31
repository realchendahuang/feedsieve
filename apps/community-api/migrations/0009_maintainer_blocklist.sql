-- 0009_maintainer_blocklist: 维护者快速维护通道。
--
-- 维护者条目与社区票数彻底分离：不制造虚假票数，不改变社区净票公式。
-- 最终公开黑名单由 community consensus 与 active maintainer entries 取并集。
CREATE TABLE maintainer_blocklist (
  handle TEXT PRIMARY KEY,
  x_user_id TEXT,
  category TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_post_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE maintainer_blocklist_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL CHECK (action IN ('add', 'remove', 'update')),
  handle TEXT NOT NULL,
  category TEXT,
  reason TEXT,
  evidence_post_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_maintainer_blocklist_active
  ON maintainer_blocklist (active, handle);

CREATE INDEX idx_maintainer_blocklist_audit_handle
  ON maintainer_blocklist_audit (handle, created_at DESC);

-- 旧版公开快照中的 6 条种子本来就是人工背书，不应继续伪装成“一票 strong”。
-- 仅在升级已有官方数据库、且这些账号确实存在时迁移；新部署不会凭空写入。
INSERT OR IGNORE INTO maintainer_blocklist
  (handle, x_user_id, category, reason, evidence_post_id, active, created_at, updated_at)
SELECT handle, x_user_id, category, '历史人工背书条目迁移；后续可由维护者页面更新或撤销',
       NULL, 1, first_report_at, updated_at
FROM accounts
WHERE handle IN (
  'cndon91',
  'crypto_teacher',
  'lucky_winner99',
  'newaccount7',
  'spamking88',
  'trxminer07'
);

INSERT INTO maintainer_blocklist_audit
  (action, handle, category, reason, evidence_post_id, created_at)
SELECT 'add', handle, category, reason, evidence_post_id, updated_at
FROM maintainer_blocklist
WHERE handle IN (
  'cndon91',
  'crypto_teacher',
  'lucky_winner99',
  'newaccount7',
  'spamking88',
  'trxminer07'
);
