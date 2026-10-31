-- 0016_maintainer_whitelist: 公开白名单（金刚防护罩）的维护者通道。
--
-- 与 0009_maintainer_blocklist 同构但语义相反：维护者在 GitHub 公开维护
-- community/lists/whitelist.yaml（PR 提交、维护者审核合并），发布脚本把
-- 文件内容同步进本表；快照生成时并入 verified 同级的新 whitelist 段，
-- 扩展端对 whitelist 账号一票否决（任何检测来源都不标注、不拉黑）。
-- 白名单优先于一切黑名单来源：命中白名单的账号不会出现在黑名单 entries。
CREATE TABLE maintainer_whitelist (
  handle TEXT PRIMARY KEY,
  x_user_id TEXT,
  note TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE maintainer_whitelist_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL CHECK (action IN ('add', 'remove', 'update')),
  handle TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_maintainer_whitelist_active
  ON maintainer_whitelist (active, handle);

CREATE INDEX idx_maintainer_whitelist_audit_handle
  ON maintainer_whitelist_audit (handle, created_at DESC);