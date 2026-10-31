-- 0003_trust: 举报者信任分（内部数据，绝不公开——治理文档 §5）。
-- 默认 1.0；单日报量越过爆发线衰减；低信任收紧每日上限。
ALTER TABLE installations ADD COLUMN trust REAL NOT NULL DEFAULT 1;
