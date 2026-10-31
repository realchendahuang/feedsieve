-- 0004_aliases: 换号追踪。同 x_user_id 的新 handle 自动归并进原账号的别名表。
ALTER TABLE accounts ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]';
