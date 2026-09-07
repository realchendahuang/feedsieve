-- consensus v2 影子：不参与入榜（v1 仍是唯一公开公式），只为影子对比与后续切换积累数据。
ALTER TABLE accounts ADD COLUMN status_v2 TEXT NOT NULL DEFAULT 'new';
ALTER TABLE accounts ADD COLUMN consensus_v2 REAL;

-- 快照发布者签名（Ed25519）：signature_json 非空 = 该快照已由发布者密钥签名。
-- 公开端点（REQUIRE_SIGNED_SNAPSHOTS=1）只服务已签名行；签名对象结构见 packages/community-lists。
ALTER TABLE snapshots ADD COLUMN signature_json TEXT;