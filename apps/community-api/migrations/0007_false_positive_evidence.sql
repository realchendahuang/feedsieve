-- 0007_false_positive_evidence: 让“误标？”成为可审计的反馈，而不只是本机白名单。
-- 不存推文原文、IP 或原始安装 ID；仅存检测器自己的 source / rule / reason。
ALTER TABLE rescues ADD COLUMN detection_source TEXT;
ALTER TABLE rescues ADD COLUMN rule_id TEXT;
ALTER TABLE rescues ADD COLUMN detection_reason TEXT;

CREATE INDEX idx_rescues_rule_id ON rescues (rule_id);
