-- 0008_active_labels: 每个匿名安装对每个账号只保留一个当前判断。
-- reports / rescues 继续保存证据；active_labels 负责计票，避免同一安装同时贡献正负票。
ALTER TABLE rescues ADD COLUMN x_user_id TEXT;

CREATE TABLE active_labels (
  installation_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  label TEXT NOT NULL CHECK (label IN ('blocked', 'allowed')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (installation_id, handle)
);

CREATE INDEX idx_active_labels_handle_label ON active_labels (handle, label);

-- 兼容已有数据：先放拉黑票，再让时间更新的白名单票覆盖。
INSERT OR IGNORE INTO active_labels (installation_id, handle, label, updated_at)
SELECT installation_id, handle, 'blocked', created_at FROM reports;

INSERT OR IGNORE INTO active_labels (installation_id, handle, label, updated_at)
SELECT installation_id, handle, 'allowed', created_at FROM rescues;

UPDATE active_labels
SET label = 'allowed',
    updated_at = (
      SELECT r.created_at
      FROM rescues r
      WHERE r.installation_id = active_labels.installation_id
        AND r.handle = active_labels.handle
    )
WHERE EXISTS (
  SELECT 1
  FROM rescues r
  WHERE r.installation_id = active_labels.installation_id
    AND r.handle = active_labels.handle
    AND r.created_at >= active_labels.updated_at
);

-- 迁移后先把普通票数收敛到当前标签；状态由应用层自动评级器继续统一推导。
UPDATE accounts
SET report_count = (
      SELECT COUNT(*) FROM active_labels l
      WHERE l.handle = accounts.handle AND l.label = 'blocked'
    ),
    rescue_count = (
      SELECT COUNT(*) FROM active_labels l
      WHERE l.handle = accounts.handle AND l.label = 'allowed'
    );
