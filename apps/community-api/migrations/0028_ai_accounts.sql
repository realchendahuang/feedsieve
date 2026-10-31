-- AI 号账号级判定结果（/v1/ai-accounts/check，见 docs/06 第 3 节）。
-- 一个账号一行：判一次、全体共享，到期后有人再遇到才重判。
-- 隐私：不存回复正文，只存参与判定的回复 ID；请求方只记加盐哈希用于配额（training_sample_usage）。
CREATE TABLE IF NOT EXISTS ai_account_verdicts (
  handle TEXT PRIMARY KEY,                -- 小写 handle
  x_user_id TEXT,
  verdict TEXT NOT NULL,                  -- ai / suspect / human / insufficient
  score REAL,                             -- Jev ai_account 概率（0–1）
  blue_verified INTEGER,                  -- 1 / 0 / NULL（未知）
  reply_count INTEGER NOT NULL DEFAULT 0, -- 参与判定的回复条数
  reply_ids TEXT,                         -- JSON 数组：参与判定的回复 ID
  rhythm TEXT,                            -- JSON：{ fast, short, cv }
  model TEXT,                             -- 例如 jev-1.14.0
  question_version INTEGER NOT NULL,
  judged_at INTEGER NOT NULL,             -- 秒
  expires_at INTEGER NOT NULL             -- 秒；过期后有人再遇到才重判
);
CREATE INDEX IF NOT EXISTS idx_ai_account_verdicts_verdict ON ai_account_verdicts(verdict, judged_at);
CREATE INDEX IF NOT EXISTS idx_ai_account_verdicts_expires ON ai_account_verdicts(expires_at);
