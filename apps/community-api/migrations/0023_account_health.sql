-- 0023_account_health: 死账号检测状态机（#2 定稿方案，2026-09-12）。
--
-- 口径：只服务官方数据侧（名单/词库快照、打野计分、admin 指标）；
-- 用户个人黑名单不做服务端清理（用户数据，不介入）。
--
-- 状态机：unknown → alive | dead；
-- - dead 是终态：注销/冻结不可逆，任何来源都不得覆写，probe 后不再复探
--   （查询侧永远排除 dead，这是控制总请求量的关键性质）。
-- - alive→dead 是唯一允许的跃迁（杀完还活着，后来死了）。
-- - updated_at 即"最近一次存活信号"：cron 取最久没刷新的条目做低频重验，
--   它在 alive 刷新时会推进，等价于"长期无信号才值得再探"。
-- - probe_count 只统计真实探测（含对已 dead 账号的随手确认），无配额语义。
CREATE TABLE account_health (
  handle TEXT PRIMARY KEY,
  x_user_id TEXT,
  state TEXT NOT NULL DEFAULT 'unknown'
    CHECK (state IN ('unknown', 'alive', 'dead')),
  source TEXT NOT NULL
    CHECK (source IN ('kill-report', 'cron-prober', 'passive-signal')),
  probe_count INTEGER NOT NULL DEFAULT 0,
  confirmed_alive_at INTEGER,
  terminal_checked_at INTEGER,
  updated_at INTEGER NOT NULL
);

-- cron 抽样按 updated_at 升序取最陈旧的非终态条目（增量 + 滚动抽样用）。
CREATE INDEX idx_account_health_recheck
  ON account_health (updated_at)
  WHERE state != 'dead';
