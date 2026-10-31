-- 0021_whitelist_display_fields: 推荐白名单补充展示字段（KOSX 卡片样式入口）。
-- name / avatar_url 与 note 一同随快照公开；note 保持公开问责纯文本口径。
ALTER TABLE maintainer_whitelist ADD COLUMN name TEXT;
ALTER TABLE maintainer_whitelist ADD COLUMN avatar_url TEXT;
