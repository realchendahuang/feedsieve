-- 0019_public_roster_applications: 官网名单公示（/v1/roster/latest）与公示申请。
--
-- 公示数据不落新表：直接读最新已发布快照（entries / verified / whitelist），
-- 公示面与扩展实际执行的名单严格同源。这里只建申请侧结构。
--
-- 申请两类（kind）：whitelist = 博主自荐进公开白名单（博主宣言）；
-- appeal = 被公示账号申诉误伤。申请走邮箱验证码（复用 email_codes，申请通道的
-- installer_hash 是固定占位哈希，无安装语义）后才进入维护者队列。
-- 状态机：pending → verified → approved / rejected（终态）。
-- 隐私红线同 0001：email_hash / ip_hash 只存加盐哈希，绝不存原始邮箱 / IP；
-- 邮箱明文只在发码瞬间使用。

CREATE TABLE applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handle TEXT NOT NULL,
  kind TEXT NOT NULL,
  statement TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  verified_at INTEGER,
  decided_at INTEGER,
  decided_by TEXT,
  decision_note TEXT
);

CREATE INDEX idx_applications_status ON applications (status, created_at DESC);
CREATE INDEX idx_applications_email ON applications (email_hash, created_at DESC);
CREATE INDEX idx_applications_handle ON applications (handle, created_at DESC);

-- 申请提交的 IP 级每日上限（与 ip_usage 同模式，独立计数，不占上报配额）
CREATE TABLE application_ip_usage (
  ip_hash TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  submissions_today INTEGER NOT NULL DEFAULT 0
);
