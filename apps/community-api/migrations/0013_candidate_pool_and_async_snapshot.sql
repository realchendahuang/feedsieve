-- 0013_candidate_pool_and_async_snapshot: 上报路径不再同步生成快照，
-- 改由 cron 每 5 分钟合并提交（脏检查见 src/snapshot.ts isSnapshotStale）；
-- 同时补齐时间窗口查询索引（24h 指标 / 社区候选池 / 脏标记轮询）。

-- 手动标记等「人」的来源与检测器区分开：规则质量分析时不再把人工操作混进 other 未知。
ALTER TABLE reports ADD COLUMN detection_source TEXT;

CREATE INDEX idx_reports_created_at ON reports (created_at);
CREATE INDEX idx_rescues_created_at ON rescues (created_at);
CREATE INDEX idx_snapshots_created_at ON snapshots (created_at);