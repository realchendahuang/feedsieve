-- 0013_candidate_pool_and_async_snapshot: 上报路径不再同步生成快照，
-- 改由 cron 每 5 分钟消费脏标记后合并生成（见 src/snapshot.ts markSnapshotDirty）；
-- 同时补齐时间窗口查询索引（24h 指标 / 社区候选池）。

-- 手动标记等「人」的来源与检测器区分开：规则质量分析时不再把人工操作混进 other 未知。
ALTER TABLE reports ADD COLUMN detection_source TEXT;

-- 快照脏标记（单行即可）：上报/抢救/撤回落库后置脏，cron 生成后清除。
-- value 存置脏时刻（毫秒），清除时按值比对，避免把生成期间到达的新变更一起清掉。
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX idx_reports_created_at ON reports (created_at);
CREATE INDEX idx_rescues_created_at ON rescues (created_at);
CREATE INDEX idx_snapshots_created_at ON snapshots (created_at);