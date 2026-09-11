-- 0022_keyword_contributions: 关键词贡献（用户主动把自己的自定义关键词匿名提交给官方）。
-- 注意与 v1/reports 的隐私口径一致：installation_id 只存 installationHash 的加盐哈希；
-- display_phrase 保存用户原文（运营人工审核入库的唯一依据），norm_phrase 作为去重主键。
-- status: new = 待审；admitted = 已纳入官方词库；rejected = 已否决（不再出现在待审列表）。

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
