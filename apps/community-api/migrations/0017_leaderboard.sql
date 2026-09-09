-- 0017_leaderboard: 打野排位赛（周赛季排行榜）。
--
-- 计分口径完全由服务端从共识数据派生，客户端报数不作数：
-- - 开火：active_labels 里 label='blocked' 的当前票（每安装每账号一票）。
-- - 确认击杀：账号收敛为 strong（净票 >= communityNetThreshold）且不在维护者
--   白名单时，consensus_events 记录达标时刻——该表即「当前处于共识内」的锚点，
--   翻案回落时删除。确认发生在赛季窗口内且猎手当前仍投 blocked 票 → +1。
-- - 首杀：账号最早的上报安装（上报时间同在窗口内）→ 额外 +1。
-- - 误伤：当前票命中 verified（抢救净票 >= 阈值）或维护者白名单 → -2。
--   误伤不设窗口：白名单 / 翻案生效即全量结账。
--
-- 榜单聚合结果写 meta 缓存，脏标记懒重算（与快照 markSnapshotDirty 同模式）：
-- 没人访问时零聚合开销，写入侧只打标记。
--
-- 身份分层：installation 哈希即匿名猎手账号（猎手#XXXXXX = 哈希前 6 位）；
-- display_name / bio 的修改需要 email_verified_at（邮箱验证码解锁，无密码）。
-- title 是结榜发放的永久荣誉称号（如「猎黄人」），不清除。

ALTER TABLE installations ADD COLUMN display_name TEXT;
ALTER TABLE installations ADD COLUMN bio TEXT;
ALTER TABLE installations ADD COLUMN email_hash TEXT;
ALTER TABLE installations ADD COLUMN email_verified_at INTEGER;
ALTER TABLE installations ADD COLUMN title TEXT;

CREATE TABLE consensus_events (
  handle TEXT PRIMARY KEY,
  x_user_id TEXT,
  confirmed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_consensus_events_confirmed
  ON consensus_events (confirmed_at);

CREATE TABLE seasons (
  id INTEGER PRIMARY KEY,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  settled_at INTEGER,
  top_json TEXT
);

CREATE TABLE email_codes (
  email_hash TEXT PRIMARY KEY,
  installer_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  -- 滑动 1 小时窗口内的发码次数（限频）；attempts 是错码尝试次数，两者分开
  send_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_email_codes_installer
  ON email_codes (installer_hash, created_at DESC);
