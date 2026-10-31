-- 0018_abuse_limits: 滥用防线。安装自报 ID 不可信（Sybil），补三层限制：
-- 1) installations 增加「撤回每日配额」「别名每日配额」计数列（与 reports_day 同模式）；
-- 2) ip_usage：IP 级每日上报上限（防止无限换安装 ID 绕过单安装配额）；
-- 3) email_send_usage：验证码发送的「按安装」小时级上限（防止换邮箱轰炸邮件通道）。
-- 隐私红线同 0001：ip_hash / installer_hash 只存加盐哈希，绝不存原始 IP / UUID。

ALTER TABLE installations ADD COLUMN retracts_day TEXT NOT NULL DEFAULT '';
ALTER TABLE installations ADD COLUMN retracts_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE installations ADD COLUMN aliases_day TEXT NOT NULL DEFAULT '';
ALTER TABLE installations ADD COLUMN aliases_today INTEGER NOT NULL DEFAULT 0;

CREATE TABLE ip_usage (
  ip_hash TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  reports_today INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE email_send_usage (
  installer_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  send_count INTEGER NOT NULL DEFAULT 0
);
