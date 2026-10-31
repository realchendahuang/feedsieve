-- 众包全站热榜：扩展上报用户正常浏览时 X 已经加载的公开帖子指标，服务端汇总出热帖。
-- 不存安装 ID：reporter 是「每日轮换的随机会话 ID」的加盐哈希，只用于限速和「至少 N 个人看到」门槛。

-- 每条帖子一行：展示字段取最近一次上报，计数取历史最大值（只用于挑候选，排序用 hot_observations 的中位数）
CREATE TABLE IF NOT EXISTS hot_posts (
  post_id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  verified INTEGER,
  followers INTEGER,
  created_at INTEGER NOT NULL,
  snippet TEXT,
  media_url TEXT,
  lang TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER,
  retweets INTEGER,
  replies INTEGER,
  quotes INTEGER,
  bookmarks INTEGER,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hot_posts_last_seen ON hot_posts(last_seen);

-- 观测点：同一会话在同一个 10 分钟桶里只留一个最大浏览数。
-- 流速按桶内各会话的中位数计算，单个伪造上报拉不动排名。
CREATE TABLE IF NOT EXISTS hot_observations (
  post_id TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  reporter TEXT NOT NULL,
  views INTEGER NOT NULL,
  PRIMARY KEY (post_id, bucket, reporter)
);
CREATE INDEX IF NOT EXISTS idx_hot_observations_bucket ON hot_observations(bucket);
