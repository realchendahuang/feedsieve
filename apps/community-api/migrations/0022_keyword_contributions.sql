-- 0022_keyword_contributions: 关键词贡献（用户主动把自己的自定义关键词匿名提交给官方）。
-- 注意与 v1/reports 的隐私口径一致：installation_id 只存 installationHash 的加盐哈希；
-- display_phrase 保存用户原文（运营人工审核入库的唯一依据），norm_phrase 作为去重主键。
-- status: new = 待审；admitted / rejected = 审阅决定（仅状态标记，不自动写入官方词库；
--   真正入库走词库工作区 + 显式发布链路）。
-- keyword_contrib_usage：每日额度原子预留表（与 reports/rescues 的条件 UPSERT 同款——
--   先 COUNT 再写的检查会两写并存绕过限额，预留本身即门禁）。day 为 UTC 日历日语义。

CREATE TABLE keyword_contributions (
  norm_phrase TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  display_phrase TEXT NOT NULL,
  client_version TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT,
  PRIMARY KEY (norm_phrase, installation_id)
);

CREATE INDEX idx_keyword_contrib_created ON keyword_contributions (created_at DESC);

CREATE TABLE keyword_contrib_usage (
  submission_key TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
