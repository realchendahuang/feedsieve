-- 迁移 0012：把 ensureAccountDrafts 的读路径迁移搬回标准的 D1 migration。
-- INSERT OR IGNORE 幂等：重复执行或与既有草稿并存都安全。
INSERT OR IGNORE INTO admin_account_drafts
  (handle, x_user_id, category, note, evidence_post_id, active, created_at, updated_at)
SELECT handle, x_user_id, category, reason, evidence_post_id, active, created_at, updated_at
FROM maintainer_blocklist;
