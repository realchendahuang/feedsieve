-- 0005_content_evidence: v0.4 内容指纹 + 外链域名（垃圾网络识别基础）。
-- 隐私红线：指纹是归一化话术文本的单向哈希（原文永不出设备），
-- link_domains 只存外链 hostname（JSON 数组），绝无完整 URL / 浏览数据。
ALTER TABLE reports ADD COLUMN content_fingerprint TEXT;
ALTER TABLE reports ADD COLUMN link_domains TEXT;

-- 快照聚合按 (handle, fingerprint) 分组；指纹列大多为 NULL，用部分索引省空间
CREATE INDEX idx_reports_fingerprint ON reports (content_fingerprint)
  WHERE content_fingerprint IS NOT NULL;
