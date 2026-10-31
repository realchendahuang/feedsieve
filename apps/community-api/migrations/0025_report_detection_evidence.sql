-- Preserve explainable detector evidence on positive reports for offline precision/recall analysis.
-- These fields are analysis-only and never directly promote an account into the public snapshot.
ALTER TABLE reports ADD COLUMN rule_id TEXT;
ALTER TABLE reports ADD COLUMN signal_ids TEXT;

CREATE INDEX idx_reports_rule_id ON reports (rule_id)
  WHERE rule_id IS NOT NULL;
