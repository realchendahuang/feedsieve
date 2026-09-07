-- 上报 / 抢救按 x_user_id 反查账号建立索引：避免每条逐项全表扫 accounts
-- （reports.ts processReportBatch / rescues.ts processRescueBatch 的 canonical 解析）。
CREATE INDEX idx_accounts_x_user_id ON accounts (x_user_id);
