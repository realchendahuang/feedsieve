-- 0006_owner_votes: 维护者（owner）特权票。
-- owner 是项目维护者自己的安装实例（服务端通过 OWNER_INSTALLATION_ID 识别，
-- 存的是加盐哈希，和普通安装一样不留原始 ID）。
-- 语义：owner 的拉黑 = 最高置信证据，1 票即 strong（全档可见），
-- 不参与普通用户的多数判定流程（v0.5 自动评级）。
ALTER TABLE accounts ADD COLUMN owner_votes INTEGER NOT NULL DEFAULT 0;